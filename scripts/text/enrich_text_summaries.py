""" Summarize a youtube transcript using chatgpt"""

import json
import os
import queue
import threading
import logging
import openai
from tenacity import (
    retry,
    wait_random_exponential,
    stop_after_attempt,
    retry_if_not_exception_type,
)
from rich.progress import Progress

AZURE_OPENAI_MODEL_DEPLOYMENT_NAME = os.getenv(
    "AZURE_OPENAI_MODEL_DEPLOYMENT_NAME", "gpt-35-turbo"
)

class Counter:
    """thread safe counter"""

    def __init__(self):
        """initialize the counter"""
        self.value = 0
        self.lock = threading.Lock()

    def increment(self):
        """increment the counter"""
        with self.lock:
            self.value += 1
            return self.value
        

counter = Counter()

@retry(
    wait=wait_random_exponential(min=10, max=45),
    stop=stop_after_attempt(20),
    retry=retry_if_not_exception_type(openai.InvalidRequestError),
)
def chatgpt_summary(config, text, logger):
    """generate a summary using chatgpt"""

    messages = [
        {
            "role": "system",
            "content": "You're an AI Assistant for summarising useful blogs, write an authoritative " 
                       + str(config.summaryWordCount) + 
                       "  word summary. Avoid starting sentences with 'This document' or 'The document'.",
        },
        {"role": "user", "content": text},
    ]

    response = openai.ChatCompletion.create(
        #AZURE VERSION WAS engine=AZURE_OPENAI_MODEL_DEPLOYMENT_NAME,
        model="gpt-3.5-turbo",
        messages=messages,
        temperature=0.7,
        max_tokens=config.maxTokens,
        top_p=0.0,
        frequency_penalty=0,
        presence_penalty=0,
        stop=None,
        request_timeout=config.openAiRequestTimeout,
    )

    # print(response)

    text = response.get("choices", [])[0].get("message", {}).get("content", text)
    finish_reason = response.get("choices", [])[0].get("finish_reason", "")

    # print(finish_reason)
    if finish_reason != "stop" and finish_reason != 'length' and finish_reason != "":
        logger.warning("Stop reason: %s", finish_reason)
        logger.warning("Text: %s", text)
        logger.warning("Increase Max Tokens and try again")
        exit(1)

    return text


def process_queue(config, progress, task, q, total_chunks, output_chunks, logger):
    """process the queue"""
    
    while not q.empty():

        chunk = q.get()

        text = chunk.get("text")

        # Think about this some more. Idea is to reduce processing time
        # text_hash = hash(text)

        # # check if there is a summary already in the chunk and the hash is the same
        # # If found then don't generate a new summary
        # if "summary" in chunk and "text_hash" in chunk and text_hash == chunk["text_hash"]:
        #     output_chunks.append(chunk.copy())
        #     q.task_done()
        #     continue

        # get a summary of the text using chatgpt
        try:
            summary = chatgpt_summary(config, text, logger)
        except openai.InvalidRequestError as invalid_request_error:
            logger.warning("Error: %s", invalid_request_error)
            summary = text
        except Exception as e:
            logger.warning("Error: %s", e)
            summary = text

        count = counter.increment()
        progress.update(task, advance=1)
        logger.debug("Processed %d chunks of %d", count, total_chunks)

        # add the summary and text hash to the chunk dictionary
        chunk["summary"] = summary

        output_chunks.append(chunk.copy())

        q.task_done()


def enrich_text_summaries(config, markdownDestinationDir): 

   logging.basicConfig(level=logging.WARNING)
   logger = logging.getLogger(__name__)

   if not markdownDestinationDir:
    logger.error("Markdown folder not provided")
    exit(1)

   chunks = []
   output_chunks = []
   total_chunks = 0

   logger.debug("Starting OpenAI summarization")

   # load the chunks from a json file
   input_file = os.path.join(markdownDestinationDir, "output", "master_markdown.json")
   with open(input_file, "r", encoding="utf-8") as f:
      chunks = json.load(f)

   total_chunks = len(chunks)

   logger.debug("Total chunks to be processed: %s", len(chunks))

   # add chunk list to a queue
   q = queue.Queue()
   for chunk in chunks:
      q.put(chunk)

   with Progress() as progress:
      task1 = progress.add_task("[purple]Enriching Summaries...", total=total_chunks)

      # create multiple threads to process the queue
      threads = []
      for i in range(config.processingThreads):
         t = threading.Thread(target=process_queue, args=(config, progress, task1, q, total_chunks, output_chunks, logger))
         t.start()
         threads.append(t)

      # wait for all threads to finish
      for t in threads:
         t.join()

   # sort the output chunks by sourceId 
   output_chunks.sort(key=lambda x: (x["sourceId"]))

   logger.debug("Total chunks processed: %s", len(output_chunks))

   # save the output chunks to a json file
   output_file = os.path.join(markdownDestinationDir, "output", "master_enriched.json")
   with open(output_file, "w", encoding="utf-8") as f:
      json.dump(output_chunks, f, ensure_ascii=False, indent=4)

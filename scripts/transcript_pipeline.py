
from config.ApiConfiguration import ApiConfiguration
from youtube.download_transcripts import download_transcripts
from youtube.enrich_transcript_chunks import enrich_transcript_chunks
from youtube.enrich_transcript_summaries import enrich_transcript_summaries
from youtube.enrich_transcript_embeddings import enrich_transcript_embeddings
from text.enrich_lite import enrich_lite

TRANSCRIPT_DESTINATION_DIR = "data/transcripts"
webUrls = [
["Stanford CS229: Machine Learning Full Course taught by Andrew Ng | Autumn 2018 - YouTube", "PLoROMvodv4rMiGQp3WXShtMGgzqpfVfbU"],
["Stanford CS224N: Natural Language Processing with Deep Learning | Winter 2021 - YouTube", "PLoROMvodv4rOSH4v6133s9LFPRHjEmbmJ"],
["Braid AI Canon", "PL9LkXkIUrSoxIlFSKcyB21XFFLCCYfPGv"],
["Braid - Additional Content", "PL9LkXkIUrSozgkPNepSMzidqtAGR0b1F_"],
["Augmented Language Models (LLM Bootcamp) (youtube.com)", "PL1T8fO7ArWleyIqOy37OVXsP4hFXymdOZ"]
]

config = ApiConfiguration()

for item in webUrls:
   download_transcripts (item[1], TRANSCRIPT_DESTINATION_DIR)
enrich_transcript_chunks(config, TRANSCRIPT_DESTINATION_DIR) 
enrich_transcript_summaries (config, TRANSCRIPT_DESTINATION_DIR) 
enrich_transcript_embeddings(config, TRANSCRIPT_DESTINATION_DIR)
enrich_lite(TRANSCRIPT_DESTINATION_DIR)
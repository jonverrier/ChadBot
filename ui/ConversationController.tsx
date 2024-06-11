/*! Copyright Braid Technologies 2022 */
// The ConversationController manages the interaction with the shared data structures, and drives a ConversationView
// ConversationPage is largely a passive view, although it does notify the controller if the local users adds a message.

// React
import React, { useState, useReducer } from 'react';

// Local
import { throwIfUndefined } from '../core/Asserts';
import { Persona } from '../core/Persona';
import { Message } from '../core/Message';
import { SharedEmbedding, findInMap } from '../core/SharedEmbedding';
import { CaucusOf } from '../core/CaucusFramework';
import { SessionKey, ConversationKey } from '../core/Keys';
import { JoinDetails } from '../core/JoinDetails';
import { JoinPageValidator } from '../core/JoinPageValidator';
import { ConversationView } from './ConversationPane';
import { BraidFluidConnection } from '../core/BraidFluidConnection';
import { Interest, NotificationFor, NotificationRouterFor, ObserverInterest } from '../core/NotificationFramework';
import { AIConnection, AIConnector } from '../core/AIConnection';
import { EUIStrings, initialQuestions } from './UIStrings';
import { EConfigNumbers, EConfigStrings } from '../core/ConfigStrings';
import { getEmbeddingRepository } from '../core/IEmbeddingRepositoryFactory';
import { getRecordRepository } from '../core/IActivityRepositoryFactory';
import { UrlActivityRecord } from '../core/ActivityRecordUrl';
import { MessageActivityRecord } from '../core/MessageActivityRecord';
import { getDefaultKeyGenerator } from '../core/IKeyGeneratorFactory';
import { LikeUnlikeActivityRecord } from '../core/ActivityRecordLikeUnlike';

export interface IConversationControllerProps {

   sessionKey: SessionKey;
   conversationKey: ConversationKey;
   localPersona: Persona; 
   onFluidError (hint_: string) : void;   
   onAiError (hint_: string) : void;        
}

let firstLoad = true;

export const ConversationControllerRow = (props: IConversationControllerProps) => {

   const [conversation, setConversation] = useState<Array<Message>>(new Array<Message>());
   const [audience, setAudience] = useState<Map<string, Persona>>(new Map<string, Persona>());
   const [sharedEmbeddings, setSharedEmbeddings] = useState<Map<string, SharedEmbedding>>(new Map<string, SharedEmbedding>());   
   const [fluidConnection, setFluidConnection] = useState<BraidFluidConnection | undefined>(undefined);
   const [joining, setJoining] = useState<boolean> (false);
   const [conversationKey, setConversationKey] = useState<ConversationKey> (props.conversationKey);   
   const [isBusy, setIsBusy] = useState<boolean>(false);
   const [suggested, setSuggested] = useState<Message|undefined>(undefined);  
   const [key, setKey] = useState<number> (0);

   const [, updateState] = React.useState<object>();
   const forceUpdate = React.useCallback(() => updateState({}), []);

   let liveText: string | undefined = undefined;

   function addMessage (fluidMessagesConnection_: BraidFluidConnection, message_: Message) : void {

      fluidMessagesConnection_.messageCaucus().add (message_.id, message_);

      // Save state and force a refresh                  
      let messageArray = fluidMessagesConnection_.messageCaucus().currentAsArray();      
      setConversation (messageArray);                
      forceUpdate ();         
   }

   function hasRecentHepfulStart (fluidMessagesConnection_: BraidFluidConnection) : boolean {

      let messageArray = fluidMessagesConnection_.messageCaucus().currentAsArray();  

      let currentTime = new Date();
      
      for (let i = 0; i < messageArray.length; i++) {

         if (messageArray[i].authorId === EConfigStrings.kLLMGuid
            && messageArray[i].isUnPrompted()) {

               let messageTime = messageArray[i].sentAt;

               let difference = currentTime.getTime() - messageTime.getTime();

               if (difference < EConfigNumbers.kHelpfulPromptMinimumGapMins * 1000) {
                  return true;
               }
         }
      }

      return false;
   }

   function makeHelpfulStart (fluidMessagesConnection_: BraidFluidConnection) : void {

      setIsBusy (true);

      setTimeout(() => {

         if (! hasRecentHepfulStart (fluidMessagesConnection_)) {
            let message = new Message();

            message.authorId = EConfigStrings.kLLMGuid;
            const randomElement = initialQuestions[Math.floor(Math.random() * initialQuestions.length)];
            message.text = randomElement;
            message.sentAt = new Date();   
            
            setSuggested(message);
         } 
         setIsBusy (false);

      }, EConfigNumbers.kHelpfulPromptDelayMsecs);  
   }

   function initialiseConnectionState (fluidMessagesConnection_: BraidFluidConnection, 
                                       conversationKey_: ConversationKey) : void {

      setFluidConnection (fluidMessagesConnection_);  

      // Notifications function for adds, removes, changes
      // Warning - this function must be declared after the call to setFluidConnection(), else it binds to the original value - which is always undefined. 
      // **************************************
      let remoteChanged = function (interest: Interest, data: NotificationFor<Message>) : void {

         let offlineRefresh = function () {       

            if (typeof fluidMessagesConnection_ !== "undefined") {

               throwIfUndefined(fluidMessagesConnection_);   // This is just to keep the compiler happy with statement below. 
               refreshLocalState (fluidMessagesConnection_);                      
            }
         }

         offlineRefresh();    
         forceUpdate ();            
      }      

      refreshLocalState (fluidMessagesConnection_);       

      let changeObserver = new NotificationRouterFor<Message> (remoteChanged);

      let changeObserverInterest = new ObserverInterest (changeObserver, CaucusOf.caucusMemberChangedInterest);
      let addedObserverInterest = new ObserverInterest (changeObserver, CaucusOf.caucusMemberAddedInterest);      
      let removedObserverInterest = new ObserverInterest (changeObserver, CaucusOf.caucusMemberRemovedInterest);

      // Hook up a notification function for adds, removes, changes in the message list       
      fluidMessagesConnection_.messageCaucus().addObserver (changeObserverInterest);
      fluidMessagesConnection_.messageCaucus().addObserver (addedObserverInterest);   
      fluidMessagesConnection_.messageCaucus().addObserver (removedObserverInterest);  
      
      // Hook up a notification function for adds, removes, changes in the participant list 
      fluidMessagesConnection_.participantCaucus().addObserver (changeObserverInterest);
      fluidMessagesConnection_.participantCaucus().addObserver (addedObserverInterest);   
      fluidMessagesConnection_.participantCaucus().addObserver (removedObserverInterest);     
      
      // Hook up a notification function for adds, removes, changes in the list of shared embeddings 
      fluidMessagesConnection_.sharedEmbeddingCaucus().addObserver (changeObserverInterest);
      fluidMessagesConnection_.sharedEmbeddingCaucus().addObserver (addedObserverInterest);   
      fluidMessagesConnection_.sharedEmbeddingCaucus().addObserver (removedObserverInterest);         
      
      setConversationKey (conversationKey_);  

      makeHelpfulStart (fluidMessagesConnection_);    
      
      /* Volume testing - works fine as of May 30 204 - few seconds to load 1,000 messages, view renders at interactive speed. 
      if (firstLoad && Environment.environment() === EEnvironment.kLocal) {
         
         for (let i = 0; i < 1000; i++) {
            let volumeTestMessage = new Message ();
            volumeTestMessage.authorId = EConfigStrings.kLLMGuid;
            volumeTestMessage.text = i.toString();
            volumeTestMessage.sentAt = new Date();        
            fluidMessagesConnection_.messageCaucus().add (volumeTestMessage.id, volumeTestMessage);              
         }
   
         firstLoad = false;
      }   
      */    
   }

   let validater = new JoinPageValidator();

   if (validater.isJoinAttemptReady (props.localPersona.email, props.localPersona.name, 
                                     props.sessionKey, props.conversationKey) && 
      fluidConnection === undefined 
      && !joining) {

      setJoining(true);

      let fluidMessagesConnection = new BraidFluidConnection ( {}, props.localPersona);
      
      if (! (props.conversationKey.looksValidConversationKey())) {

         fluidMessagesConnection.createNew (props.sessionKey).then (conversationKey_ => {
        
            initialiseConnectionState (fluidMessagesConnection, conversationKey_);
            setJoining (false);

         }).catch ((e : any) => {
         
            props.onFluidError ("Error creating new conversation, session: " + props.sessionKey.toString() + ".");
            setJoining (false);
         })
      }
      else {

         fluidMessagesConnection.attachToExisting (props.sessionKey, conversationKey).then (conversationKey_ => {

            initialiseConnectionState (fluidMessagesConnection, conversationKey_);
         
            setJoining (false);

         }).catch ((e: any) => {
         
            props.onFluidError (e? e.toString() : EUIStrings.kJoinApiError + " :" + conversationKey.toString() + ".");
            setJoining (false);
         })
      }
   }

   audience.set (props.localPersona.id, props.localPersona);  
   
   function refreshLocalState (fluidConnection_ : BraidFluidConnection) : void {

      // Save state and force a refresh
      let messageArray = fluidConnection_.messageCaucus().currentAsArray();   
      setConversation (messageArray);           
      let audienceMap = fluidConnection_.participantCaucus().current();  
      setAudience (audienceMap);            
      let sharedEmbeddingMap = fluidConnection_.sharedEmbeddingCaucus().current();
      setSharedEmbeddings (sharedEmbeddingMap);       
   }

   function refreshAfterTrim () : void {

      throwIfUndefined (fluidConnection);    
      
      refreshLocalState (fluidConnection);
                    
      forceUpdate ();       
   }

   function onExitConversation () : void {

      let query = JoinDetails.toString ("", "", props.sessionKey, new ConversationKey(""));
      location.replace (EConfigStrings.kHomeRelativeUrl + '#' + query);   
      location.reload();    
   }

   function onTrimConversation () : void {

      throwIfUndefined (fluidConnection);
      let fluidMessagesConnection : BraidFluidConnection = fluidConnection;      
      fluidMessagesConnection.resetMessages ();  
      refreshAfterTrim ();        
   }

   function onUnlikeUrl (url_: string) : void {
      
      let map = fluidConnection?.sharedEmbeddingCaucus().current();
      if (map) {
         let item = findInMap (url_, map);
         if (item) {
            item.unlike (props.localPersona.name);
            fluidConnection?.sharedEmbeddingCaucus().amend (item.id, item);           
         }
         else {
            item = new SharedEmbedding ();
            item.url = url_;
            item.unlike (props.localPersona.name);
            fluidConnection?.sharedEmbeddingCaucus().add (item.id, item);                            
         }
         map.set (item.id, item) ;
         setSharedEmbeddings (map);     
         forceUpdate();     
      }

      let keyGenerator = getDefaultKeyGenerator();

      let repository = getRecordRepository(props.sessionKey);
      let email = props.localPersona.email;
      let record = new LikeUnlikeActivityRecord (keyGenerator.generateKey(), 
         props.conversationKey.toString(),
         email, new Date(), url_, false);
      repository.save (record);                                                            
   }

   function onLikeUrl (url_: string) : void {
      
      let keyGenerator = getDefaultKeyGenerator();

      let repository = getRecordRepository(props.sessionKey);
      let email = props.localPersona.email;
      let record = new LikeUnlikeActivityRecord (keyGenerator.generateKey(), 
         props.conversationKey.toString(),
         email, new Date(), url_, true);
      repository.save (record); 

      onPostiveUseOfUrl (url_);                                                            
   }

   function onClickUrl (url_: string) : void {
      
      let keyGenerator = getDefaultKeyGenerator();

      let repository = getRecordRepository(props.sessionKey);
      let email = props.localPersona.email;
      let record = new UrlActivityRecord (keyGenerator.generateKey(), 
         props.conversationKey.toString(),
         email, new Date(), url_);
      repository.save (record); 

      onPostiveUseOfUrl (url_);                                                            
   }

   function onPostiveUseOfUrl (url_: string) : void {
      
      let map = fluidConnection?.sharedEmbeddingCaucus().current();
      if (map) {
         let item = findInMap (url_, map);
         if (item) {
            item.like (props.localPersona.name);
            fluidConnection?.sharedEmbeddingCaucus().amend (item.id, item);              
         }
         else {
            item = new SharedEmbedding ();
            item.url = url_;
            item.like (props.localPersona.name);
            fluidConnection?.sharedEmbeddingCaucus().add (item.id, item);            
         }
         map.set (item.id, item) ;
         setSharedEmbeddings (map);  
         forceUpdate();                   
      }

      let embeddingRespository = getEmbeddingRepository (props.sessionKey);

      // Get the summary of the URL the user clocked on
      let summary = embeddingRespository.lookupUrlSummary (url_);
      summary.then ((summaryText: string) => {

         let connectionPromise = AIConnector.connect (props.sessionKey);
      
         // Connext to the LLM
         connectionPromise.then ( (connection : AIConnection) => { 

            // Ask the LLM for a question based on the summary            
            connection.makeFollowUpCall (summaryText).then ((result_: Message) => {                                                                               
               if (result_) {
                  result_.authorId = props.localPersona.id;
                  setSuggested (result_);
               }
            });
         });  
      });                                                                
   }

   function onAddSuggestedContent () {

      throwIfUndefined (fluidConnection);
      let fluidMessagesConnection : BraidFluidConnection = fluidConnection;

      throwIfUndefined (suggested);      
      suggested.sentAt = new Date(); // Need to reset date so it goes at the end. 

      if (suggested.chunks && suggested.chunks.length > 0) {
         // If we have attached chucks, its a full message that we just replay
         addMessage (fluidMessagesConnection, suggested); 
      }
      else {
         // Else its is text, so we play it as a message that makes a request to the LLM, which sends all the context with it to the LLM
         let fullMessage = EConfigStrings.kLLMRequestSignature + " " + suggested.text;
         onSend (fullMessage);
      }

      setSuggested (undefined);
   }

   function onCancelSuggestedContent () {
      setSuggested (undefined);
   }
 
   // Hook the message for updates via streaming
   // When we get an update, push it to shared memory for other clients and then refresh the local UI
   let onStreamedUpdate = function  (message: Message, more: boolean) {

      if (fluidConnection) {

         fluidConnection.messageCaucus().amend (message.id, message); 
              
         if (more)
            liveText = message.text;      
         else
            liveText = undefined;

         setKey (Math.random());
      }
   }     

   function onSend (messageText_: string) : void {

      throwIfUndefined (fluidConnection);
      let fluidMessagesConnection : BraidFluidConnection = fluidConnection;       

      // set up a message to append
      let message = new Message ();
      message.authorId = props.localPersona.id;
      message.text = messageText_;
      message.sentAt = new Date();

      // Push it to shared data
      fluidMessagesConnection.messageCaucus().add (message.id, message);

      // Update the timestamp of the person who posted it
      let storedPerson = fluidMessagesConnection.participantCaucus().get (props.localPersona.id);
      storedPerson.lastSeenAt = message.sentAt;
      fluidMessagesConnection.participantCaucus().amend (storedPerson.id, storedPerson);    
      
      // Save it to the DB - async
      let keyGenerator = getDefaultKeyGenerator();      
      let repository = getRecordRepository(props.sessionKey);
      let email = props.localPersona.email;
      let record = new MessageActivityRecord (keyGenerator.generateKey(), 
         props.conversationKey.toString(),
         email, new Date(), messageText_);
      repository.save (record);       

      // Save state and force a refresh
      // NB we keep local variables this time - dont just call the 'refreshLocalState' else you risk stale state
      let messageArray = fluidMessagesConnection.messageCaucus().currentAsArray();      
      setConversation (messageArray);      
      let audienceMap = fluidMessagesConnection.participantCaucus().current();
      setAudience (audienceMap);     
      let sharedEmbeddingMap = fluidMessagesConnection.sharedEmbeddingCaucus().current();
      setSharedEmbeddings (sharedEmbeddingMap);       

      // If LLM is being invoked we make a call here 
      // ======================================================
      if (AIConnection.isRequestForLLM (message, audienceMap)) {

         setIsBusy(true);

         let connectionPromise = AIConnector.connect (props.sessionKey);

         connectionPromise.then ( (connection : AIConnection) => {           

            let query = connection.buildDirectQuery (messageArray, audienceMap);
            let responseShell = new Message (keyGenerator.generateKey(), EConfigStrings.kLLMGuid, message.id, 
                                             "", new Date()); 

            // Push the shell to shared data
            addMessage (fluidMessagesConnection, responseShell);                                             
            
            responseShell.hookLiveAppend (onStreamedUpdate);

            connection.makeEnrichedCall (responseShell, query).then ((result_: Message) => {            

               setIsBusy(false);    
               responseShell.unhookLiveAppend();     
               fluidConnection.messageCaucus().amend (result_.id, result_);                                               

            }).catch ( (e: any) => {
               
               props.onAiError (EUIStrings.kAiApiError);
               setIsBusy(false);      
               responseShell.unhookLiveAppend();                                          
            });            

         }).catch ( (e: any) => {
            props.onAiError (EUIStrings.kJoinApiError + " :" + props.sessionKey.toString() + ".");
            setIsBusy(false);             
         });
      }
      else
      // If the user looks they have miss-typed, we send a reminder.  
      // ======================================================      
      if (AIConnection.mightBeMissTypedRequestForLLM (message, audienceMap)) {

         // set up a message to append
         let response = new Message ();
         response.authorId = EConfigStrings.kLLMGuid;
         response.text = EUIStrings.kLLMNameReminder;
         response.sentAt = new Date();
         response.responseToId = message.id;

         // Push it to shared data
         addMessage (fluidMessagesConnection, response);                         
      }
      forceUpdate ();      
   } 

   let joinValidator = new JoinPageValidator ();

   if (! joinValidator.isJoinAttemptReady (props.localPersona.email, props.localPersona.name, 
                                           props.sessionKey, props.conversationKey)) {
      return (<div></div>);
   }
   else {  
      return (
         <ConversationView key = {key}
             isConnected={props.sessionKey.looksValidSessionKey() && conversationKey.looksValidConversationKey()}
             isBusy = {isBusy}
             sessionKey={props.sessionKey}
             localPersonaName={props.localPersona.name}
             conversationKey={conversationKey}
             conversation={conversation}
             audience={audience} 
             sharedEmbeddings={sharedEmbeddings}
             hasSuggestedContent={suggested ? true: false}
             suggestedContent={suggested ? suggested.text: ""}
             onSend={onSend} 
             onAddSuggestedContent={onAddSuggestedContent}
             onCancelSuggestedContent={onCancelSuggestedContent}
             onTrimConversation={onTrimConversation}
             onExitConversation={onExitConversation}             
             onClickUrl={onClickUrl}
             onLikeUrl={onLikeUrl}    
             onUnlikeUrl={onUnlikeUrl}                    
             >
         </ConversationView>
      );
   }
}


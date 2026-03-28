"use client";

import Image from "next/image";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { interviewer } from "@/constants";
import { createFeedback } from "@/lib/actions/general.action";

enum CallStatus {
  INACTIVE = "INACTIVE",
  CONNECTING = "CONNECTING",
  ACTIVE = "ACTIVE",
  FINISHED = "FINISHED",
}

interface SavedMessage {
  role: "user" | "system" | "assistant";
  content: string;
}

interface AgentProps {
  userName?: string;
  userId?: string;
  interviewId?: string;
  feedbackId?: string;
  type?: "generate" | "normal";
  questions?: string[];
}

const Agent = ({
  userName,
  userId,
  interviewId,
  feedbackId,
  type,
  questions,
}: AgentProps) => {
  const router = useRouter();
  const [callStatus, setCallStatusState] = useState<CallStatus>(CallStatus.INACTIVE);
  const callStatusRef = useRef<CallStatus>(CallStatus.INACTIVE);

  const setCallStatus = (status: CallStatus) => {
    callStatusRef.current = status;
    setCallStatusState(status);
  };
  const [messages, setMessages] = useState<SavedMessage[]>([]);
  const messagesRef = useRef<SavedMessage[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [lastMessage, setLastMessage] = useState<string>("");

  const recognitionRef = useRef<any>(null);
  const synthRef = useRef<any>(null);

  // Keep messagesRef in sync with messages state
  useEffect(() => {
    messagesRef.current = messages;
    if (messages.length > 0) {
      setLastMessage(messages[messages.length - 1].content);
    }
  }, [messages]);

  // Initialize speech recognition and synthesis
  useEffect(() => {
    if (typeof window !== "undefined") {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = "en-US";
        recognitionRef.current = recognition;
      }
      synthRef.current = window.speechSynthesis;
    }

    return () => {
      if (synthRef.current) {
        synthRef.current.cancel();
      }
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, []);

  const handleGenerateFeedback = async (currentMessages: SavedMessage[]) => {
    if (!interviewId || !userId) return router.push("/");
    const { success, feedbackId: id } = await createFeedback({
      interviewId,
      userId,
      transcript: currentMessages,
      feedbackId,
    });
    if (success && id) {
      router.push(`/interview/${interviewId}/feedback`);
    } else {
      router.push("/");
    }
  };

  const getSystemPrompt = useCallback(() => {
    if (type === "generate") {
      return `You are a helpful job interview prep coach. You are helping ${userName || "a user"} prepare for their interviews. Keep it short, conversational and professional.`;
    }
    const formattedQuestions = questions ? questions.map((q) => `- ${q}`).join("\n") : "";
    return interviewer.model!.messages![0].content.replace("{{questions}}", formattedQuestions);
  }, [type, userName, questions]);

  const startListening = useCallback(() => {
    if (callStatusRef.current === CallStatus.FINISHED) return;
    if (!recognitionRef.current) return;
    try {
      recognitionRef.current.start();
    } catch (e) {
      // Already started, ignore
    }
  }, []);

  const speakAndListen = useCallback((text: string) => {
    if (callStatusRef.current === CallStatus.FINISHED) return;

    if (synthRef.current) {
      synthRef.current.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => {
        setIsSpeaking(false);
        startListening();
      };
      // Temporary workaround for browser bug where synthesis stops early
      (window as any).__utterance = utterance;
      synthRef.current.speak(utterance);
    }
  }, [startListening]);

  const handleUserSpeech = useCallback(async (transcript: string) => {
    if (callStatusRef.current === CallStatus.FINISHED) return;

    // Use ref for current messages to avoid stale closure
    const currentMessages = messagesRef.current;
    const newMessages: SavedMessage[] = [...currentMessages, { role: "user", content: transcript }];
    setMessages(newMessages);
    messagesRef.current = newMessages;

    // Call API
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          systemPrompt: getSystemPrompt(),
        }),
      });
      const data = await response.json();
      if (data.success) {
        const assistantMsg: SavedMessage = { role: "assistant", content: data.text };
        const updatedMessages = [...newMessages, assistantMsg];
        setMessages(updatedMessages);
        messagesRef.current = updatedMessages;
        speakAndListen(data.text);
      } else {
        console.warn("Chat API error:", data.error);
        toast.error("Failed to get AI response. Please try again.");
        startListening();
      }
    } catch (error) {
      console.warn("Error communicating with chat API:", error);
      toast.error("Connection error. Please check your internet.");
      startListening();
    }
  }, [getSystemPrompt, speakAndListen, startListening]);

  // Set up speech recognition event handlers
  useEffect(() => {
    if (!recognitionRef.current) return;

    recognitionRef.current.onresult = (event: any) => {
      if (callStatusRef.current === CallStatus.FINISHED) return;
      const transcript = event.results[event.results.length - 1][0].transcript;
      handleUserSpeech(transcript);
    };

    recognitionRef.current.onerror = (event: any) => {
      console.warn("Speech recognition error:", event.error);
      if (event.error === 'not-allowed') {
        toast.error("Microphone access denied. Please allow microphone permission in your browser and try again.");
        setCallStatus(CallStatus.INACTIVE);
        return;
      }
      if (event.error === 'no-speech' && callStatusRef.current !== CallStatus.FINISHED) {
        startListening();
      }
      if (event.error === 'aborted' && callStatusRef.current !== CallStatus.FINISHED) {
        // Recognition was aborted, restart after a short delay
        setTimeout(() => startListening(), 300);
      }
    };

    recognitionRef.current.onend = () => {
      // If call is still active and AI is not speaking, restart listening
      // This handles cases where recognition stops unexpectedly
      if (callStatusRef.current === CallStatus.ACTIVE && !synthRef.current?.speaking) {
        // Small delay to avoid immediate restart conflicts
        setTimeout(() => {
          if (callStatusRef.current === CallStatus.ACTIVE && !synthRef.current?.speaking) {
            startListening();
          }
        }, 500);
      }
    };
  }, [handleUserSpeech, startListening]);

  const handleCall = async () => {
    setCallStatus(CallStatus.ACTIVE);
    
    // Initial greeting
    const firstMsgStr = type === "generate" 
      ? `Hi ${userName || "there"}, I'm here to help you prep for your interviews. Ready to start?`
      : interviewer.firstMessage || "Hello! Let's start the interview.";
      
    const initialMessages: SavedMessage[] = [{ role: "assistant", content: firstMsgStr }];
    setMessages(initialMessages);
    messagesRef.current = initialMessages;
    speakAndListen(firstMsgStr);
  };

  const handleDisconnect = () => {
    setCallStatus(CallStatus.FINISHED);
    if (synthRef.current) synthRef.current.cancel();
    if (recognitionRef.current) recognitionRef.current.abort();
    
    if (type === "generate") {
      router.push("/");
    } else {
      handleGenerateFeedback(messagesRef.current);
    }
  };

  return (
    <>
      <div className="call-view">
        {/* AI Interviewer Card */}
        <div className="card-interviewer">
          <div className="avatar">
            <Image
              src="/ai-avatar.png"
              alt="profile-image"
              width={65}
              height={54}
              className="object-cover"
            />
            {isSpeaking && <span className="animate-speak" />}
          </div>
          <h3>AI Interviewer</h3>
        </div>

        {/* User Profile Card */}
        <div className="card-border">
          <div className="card-content">
            <Image
              src="/user-avatar.png"
              alt="profile-image"
              width={539}
              height={539}
              className="rounded-full object-cover size-[120px]"
            />
            <h3>{userName || "Candidate"}</h3>
          </div>
        </div>
      </div>

      {messages.length > 0 && (
        <div className="transcript-border">
          <div className="transcript">
            <p
              key={lastMessage}
              className={cn(
                "transition-opacity duration-500 opacity-0",
                "animate-fadeIn opacity-100"
              )}
            >
              {lastMessage}
            </p>
          </div>
        </div>
      )}

      <div className="w-full flex justify-center">
        {callStatus !== CallStatus.ACTIVE && callStatus !== CallStatus.CONNECTING ? (
          <button className="relative btn-call" onClick={handleCall}>
            <span
              className={cn(
                "absolute animate-ping rounded-full opacity-75 hidden"
              )}
            />
            <span className="relative">
              {callStatus === CallStatus.INACTIVE || callStatus === CallStatus.FINISHED
                ? "Call"
                : ". . ."}
            </span>
          </button>
        ) : (
          <button className="btn-disconnect" onClick={handleDisconnect}>
            End
          </button>
        )}
      </div>
    </>
  );
};

export default Agent;

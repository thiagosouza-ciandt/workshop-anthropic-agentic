"use client";

import { useEffect, useRef, useState } from "react";
import config from "@/config";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import {
  HandHelping,
  WandSparkles,
  LifeBuoyIcon,
  BookOpenText,
  ChevronDown,
  Send,
} from "lucide-react";
import "highlight.js/styles/atom-one-dark.css";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import Image from "next/image";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const TypedText = ({ text = "", delay = 5 }) => {
  const [displayedText, setDisplayedText] = useState("");

  useEffect(() => {
    if (!text) return;
    const timer = setTimeout(() => {
      setDisplayedText(text.substring(0, displayedText.length + 1));
    }, delay);
    return () => clearTimeout(timer);
  }, [text, displayedText, delay]);

  return <>{displayedText}</>;
};

type ThinkingContent = {
  id: string;
  content: string;
  user_mood: string;
  debug: any;
  matched_categories?: string[];
};

interface ConversationHeaderProps {
  selectedModel: string;
  setSelectedModel: (modelId: string) => void;
  models: Model[];
  showAvatar: boolean;
}

const UISelector = ({
  redirectToAgent,
  handoffInitiated,
}: {
  redirectToAgent: { should_redirect: boolean; reason: string };
  handoffInitiated?: boolean;
}) => {
  // Handoff already created — show a quiet status, no button needed
  if (handoffInitiated) {
    return (
      <p className="mt-2 text-sm text-muted-foreground flex items-center gap-1">
        <LifeBuoyIcon className="w-3 h-3" />
        A human agent will be with you shortly.
      </p>
    );
  }

  if (redirectToAgent.should_redirect) {
    return (
      <Button
        size="sm"
        className="mt-2 flex items-center space-x-2"
        onClick={() => {
          console.log("🔥 Human Agent Connection Requested!", redirectToAgent);
          const event = new CustomEvent("humanAgentRequested", {
            detail: {
              reason: redirectToAgent.reason || "Unknown",
              mood: "frustrated",
              timestamp: new Date().toISOString(),
            },
          });
          window.dispatchEvent(event);
        }}
      >
        <LifeBuoyIcon className="w-4 h-4" />
        <small className="text-sm leading-none">Talk to a human</small>
      </Button>
    );
  }

  return null;
};

const SuggestedQuestions = ({
  questions,
  onQuestionClick,
  isLoading,
}: {
  questions: string[];
  onQuestionClick: (question: string) => void;
  isLoading: boolean;
}) => {
  if (!questions || questions.length === 0) return null;

  return (
    <div className="mt-2 pl-10">
      {questions.map((question, index) => (
        <Button
          key={index}
          className="text-sm mb-2 mr-2 ml-0 text-gray-500 shadow-sm"
          variant="outline"
          size="sm"
          onClick={() => onQuestionClick(question)}
          disabled={isLoading}
        >
          {question}
        </Button>
      ))}
    </div>
  );
};

const MessageContent = ({
  content,
  role,
}: {
  content: string;
  role: string;
}) => {
  const [thinking, setThinking] = useState(true);
  const [parsed, setParsed] = useState<{
    response?: string;
    thinking?: string;
    user_mood?: string;
    suggested_questions?: string[];
    redirect_to_agent?: { should_redirect: boolean; reason: string };
    handoff_initiated?: boolean;
    debug?: {
      context_used: boolean;
    };
  }>({});
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!content || role !== "assistant") return;

    const timer = setTimeout(() => {
      setError(true);
      setThinking(false);
    }, 90000);

    try {
      const result = JSON.parse(content);
      console.log("🔍 Parsed Result:", result);

      if (
        result.response &&
        result.response.length > 0 &&
        result.response !== "..."
      ) {
        setParsed(result);
        setThinking(false);
        clearTimeout(timer);
      }
    } catch (error) {
      console.error("Error parsing JSON:", error);
      setError(true);
      setThinking(false);
    }

    return () => clearTimeout(timer);
  }, [content, role]);

  if (thinking && role === "assistant") {
    return (
      <div className="flex items-center">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-900 mr-2" />
        <span>Thinking...</span>
      </div>
    );
  }

  if (error && !parsed.response) {
    return <div>Something went wrong. Please try again.</div>;
  }

  return (
    <>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeHighlight]}
      >
        {parsed.response || content}
      </ReactMarkdown>
      {(parsed.redirect_to_agent || parsed.handoff_initiated) && (
        <UISelector
          redirectToAgent={parsed.redirect_to_agent ?? { should_redirect: false, reason: "" }}
          handoffInitiated={parsed.handoff_initiated}
        />
      )}
    </>
  );
};

type Model = {
  id: string;
  name: string;
};

interface Message {
  id: string;
  role: string;
  content: string;
}

interface ConversationHeaderProps {
  selectedModel: string;
  setSelectedModel: (modelId: string) => void;
  models: Model[];
  showAvatar: boolean;
}

const ConversationHeader: React.FC<ConversationHeaderProps> = ({
  selectedModel,
  setSelectedModel,
  models,
  showAvatar,
}) => (
  <div className="p-0 flex flex-col sm:flex-row items-start sm:items-center justify-between pb-2 animate-fade-in">
    <div className="flex items-center space-x-4 mb-2 sm:mb-0">
      {showAvatar && (
        <>
          <Avatar className="w-10 h-10 border">
            <AvatarImage
              src="/ant-logo.svg"
              alt="AI Assistant Avatar"
              width={40}
              height={40}
            />
            <AvatarFallback>AI</AvatarFallback>
          </Avatar>
          <div>
            <h3 className="text-sm font-medium leading-none">AI Agent</h3>
            <p className="text-sm text-muted-foreground">Research Agent</p>
          </div>
        </>
      )}
    </div>
    <div className="flex space-x-2 w-full sm:w-auto">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="flex-grow text-muted-foreground sm:flex-grow-0"
          >
            {models.find((m) => m.id === selectedModel)?.name}
            <ChevronDown className="ml-2 h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {models.map((model) => (
            <DropdownMenuItem
              key={model.id}
              onSelect={() => setSelectedModel(model.id)}
            >
              {model.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </div>
);

function ChatArea() {
  const conversationIdRef = useRef(crypto.randomUUID());
  const conversationId = conversationIdRef.current;
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showHeader, setShowHeader] = useState(false);
  const [selectedModel, setSelectedModel] = useState("us.anthropic.claude-opus-4-8");
  const [showAvatar, setShowAvatar] = useState(false);
  const [handoffMode, setHandoffMode] = useState(false); // when true, messages bypass the AI and go to the human agent
  const [chatClosed, setChatClosed] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Restore conversation from sessionStorage after hydration to survive page refreshes
  useEffect(() => {
    const savedId   = sessionStorage.getItem("corpbank_conversation_id");
    const savedMsgs = sessionStorage.getItem("corpbank_messages");
    const savedMode = sessionStorage.getItem("corpbank_handoff_mode");

    if (savedId) {
      conversationIdRef.current = savedId;
    } else {
      sessionStorage.setItem("corpbank_conversation_id", conversationIdRef.current);
    }

    if (savedMsgs) {
      try {
        const msgs = JSON.parse(savedMsgs);
        if (msgs.length > 0) {
          setMessages(msgs);
          setShowHeader(true);
          setShowAvatar(true);
        }
      } catch {}
    }
    if (savedMode === "true") setHandoffMode(true);
    setHydrated(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const models: Model[] = [
    { id: "us.anthropic.claude-opus-4-8", name: "Claude Opus 4.8" },
    { id: "us.anthropic.claude-haiku-4-5-20251001-v1:0", name: "Claude Haiku 4.5" },
  ];

  // Persist state to sessionStorage on every change
  useEffect(() => {
    try { sessionStorage.setItem("corpbank_messages", JSON.stringify(messages)); } catch {}
  }, [messages]);

  useEffect(() => {
    sessionStorage.setItem("corpbank_handoff_mode", String(handoffMode));
  }, [handoffMode]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    console.log("🔍 Messages changed! Count:", messages.length);

    const scrollToNewestMessage = () => {
      if (messagesEndRef.current) {
        console.log("📜 Scrolling to newest message...");
        const behavior = messages.length <= 2 ? "auto" : "smooth";
        messagesEndRef.current.scrollIntoView({ behavior, block: "end" });
      } else {
        console.log("❌ No scroll anchor found!");
      }
    };

    if (messages.length > 0) {
      setTimeout(scrollToNewestMessage, 100);
    }
  }, [messages]);

  useEffect(() => {
    if (!config.includeLeftSidebar) {
      const handleUpdateSidebar = (event: CustomEvent<ThinkingContent>) => {
        console.log("LeftSidebar not included. Event data:", event.detail);
      };

      window.addEventListener(
        "updateSidebar" as any,
        handleUpdateSidebar as EventListener,
      );
      return () =>
        window.removeEventListener(
          "updateSidebar" as any,
          handleUpdateSidebar as EventListener,
        );
    }
  }, []);

  useEffect(() => {
    if (!config.includeRightSidebar) {
      const handleUpdateRagSources = (event: CustomEvent) => {
        console.log("RightSidebar not included. RAG sources:", event.detail);
      };

      window.addEventListener(
        "updateRagSources" as any,
        handleUpdateRagSources as EventListener,
      );
      return () =>
        window.removeEventListener(
          "updateRagSources" as any,
          handleUpdateRagSources as EventListener,
        );
    }
  }, []);

  // SSE — receive real-time events from the backoffice (human messages, loan decisions)
  useEffect(() => {
    const es = new EventSource(`/api/stream?channel=${conversationId}`);

    const addMsg = (response: string, opts: object = {}) =>
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: JSON.stringify({
          response,
          thinking: "",
          user_mood: "neutral",
          suggested_questions: [],
          redirect_to_agent: { should_redirect: false },
          debug: { context_used: false },
          ...opts,
        }),
      }]);

    es.addEventListener("human_message", (e) => {
      const { message, from } = JSON.parse(e.data);
      addMsg(`**[${from}]** ${message}`);
    });

    es.addEventListener("loan_resolved", (e) => {
      const { decision, reason, amount } = JSON.parse(e.data);
      const amountStr = amount ? ` Amount approved: **$${Number(amount).toLocaleString()}**.` : "";
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: JSON.stringify({
          response: `Your request has been **${decision}**.${amountStr}${reason ? ` Reason: ${reason}` : ""}`,
          thinking: "",
          user_mood: decision === "approved" ? "positive" : "negative",
          suggested_questions: [
            "Is there anything else I can help you with?",
            "What are my current account balances?",
            "No, that's all — thank you!",
          ],
          redirect_to_agent: { should_redirect: false },
          debug: { context_used: false },
        }),
      }]);
      setHandoffMode(false);
    });

    es.addEventListener("agent_returned", () => {
      addMsg("You've been transferred back to the AI assistant. How can I help you?");
      setHandoffMode(false);
    });

    es.onerror = () => console.warn("SSE: reconnecting...");
    return () => es.close();
  }, [conversationId]);

  const decodeDebugData = (response: Response) => {
    const debugData = response.headers.get("X-Debug-Data");
    if (debugData) {
      try {
        const parsed = JSON.parse(debugData);
        console.log("🔍 Server Debug:", parsed.msg, parsed.data);
      } catch (e) {
        console.error("Debug decode failed:", e);
      }
    }
  };

  const logDuration = (label: string, duration: number) => {
    console.log(`⏱️ ${label}: ${duration.toFixed(2)}ms`);
  };

  const handleSubmit = async (
    event: React.FormEvent<HTMLFormElement> | string,
  ) => {
    if (typeof event !== "string") {
      event.preventDefault();
    }
    if (!showHeader) setShowHeader(true);
    if (!showAvatar) setShowAvatar(true);

    const text = typeof event === "string" ? event : input;

    // In handoff mode, forward the message directly to the human agent
    if (handoffMode) {
      if (!text.trim()) return;
      setInput("");
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
      }]);
      await fetch("/api/handoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "customer_reply", conversation_id: conversationId, message: text }),
      });
      return;
    }

    setIsLoading(true);

    const clientStart = performance.now();
    console.log("🔄 Starting request: " + new Date().toISOString());

    const userMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };

    const placeholderMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: JSON.stringify({
        response: "",
        thinking: "AI is processing...",
        user_mood: "neutral",
        debug: {
          context_used: false,
        },
      }),
    };

    setMessages((prevMessages) => [
      ...prevMessages,
      userMessage,
      placeholderMessage,
    ]);
    setInput("");

    const placeholderDisplayed = performance.now();
    logDuration("Perceived Latency", placeholderDisplayed - clientStart);

    try {
      console.log("➡️ Sending message to API:", userMessage.content);
      const startTime = performance.now();
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMessage],
          model: selectedModel,
          conversationId,
        }),
      });

      const responseReceived = performance.now();
      logDuration("Full Round Trip", responseReceived - startTime);
      logDuration("Network Duration", responseReceived - startTime);

      decodeDebugData(response);

      if (!response.ok) {
        throw new Error(`API request failed with status ${response.status}`);
      }

      const data = await response.json();

      const endTime = performance.now();
      logDuration("JSON Parse Duration", endTime - responseReceived);
      logDuration("Total API Duration", endTime - startTime);
      console.log("⬅️ Received response from API:", data);

      const suggestedQuestionsHeader = response.headers.get(
        "x-suggested-questions",
      );
      if (suggestedQuestionsHeader) {
        data.suggested_questions = JSON.parse(suggestedQuestionsHeader);
      }

      const ragHeader = response.headers.get("x-rag-sources");
      if (ragHeader) {
        const ragProcessed = performance.now();
        logDuration(
          "🔍 RAG Processing Duration",
          ragProcessed - responseReceived,
        );
        const sources = JSON.parse(ragHeader);
        window.dispatchEvent(
          new CustomEvent("updateRagSources", {
            detail: {
              sources,
              query: userMessage.content,
              debug: data.debug,
            },
          }),
        );
      }

      const readyToRender = performance.now();
      logDuration("Response Processing", readyToRender - responseReceived);

      setMessages((prevMessages) => {
        const newMessages = [...prevMessages];
        const lastIndex = newMessages.length - 1;
        newMessages[lastIndex] = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: JSON.stringify(data),
        };
        return newMessages;
      });

      const sidebarEvent = new CustomEvent("updateSidebar", {
        detail: {
          id: data.id,
          content: data.thinking?.trim(),
          user_mood: data.user_mood,
          debug: data.debug,
          matched_categories: data.matched_categories,
        },
      });
      window.dispatchEvent(sidebarEvent);

      if (data.handoff_initiated) setHandoffMode(true);

      if (data.redirect_to_agent && data.redirect_to_agent.should_redirect) {
        window.dispatchEvent(
          new CustomEvent("agentRedirectRequested", {
            detail: data.redirect_to_agent,
          }),
        );
      }
    } catch (error) {
      console.error("Error fetching chat response:", error);
      console.error("Failed to process message:", userMessage.content);
    } finally {
      setIsLoading(false);
      const clientEnd = performance.now();
      logDuration("Total Client Operation", clientEnd - clientStart);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (input.trim() !== "") {
        handleSubmit(e as any);
      }
    }
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const textarea = event.target;
    setInput(textarea.value);

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 300)}px`;
  };

  const CLOSE_PHRASES = ["no, that's all", "that's all", "no, thanks", "goodbye", "encerrar"];

  const handleSuggestedQuestionClick = (question: string) => {
    if (CLOSE_PHRASES.some((p) => question.toLowerCase().includes(p))) {
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "user", content: question },
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: JSON.stringify({
            response: "Thank you for contacting CorpBank. Have a great day!",
            thinking: "",
            user_mood: "positive",
            suggested_questions: [],
            redirect_to_agent: { should_redirect: false },
            debug: { context_used: false },
          }),
        },
      ]);
      setChatClosed(true);
      return;
    }
    handleSubmit(question);
  };

  useEffect(() => {
    const handleToolExecution = (event: Event) => {
      const customEvent = event as CustomEvent<{
        ui: { type: string; props: any };
      }>;
      console.log("Tool execution event received:", customEvent.detail);
    };

    window.addEventListener("toolExecution", handleToolExecution);
    return () =>
      window.removeEventListener("toolExecution", handleToolExecution);
  }, []);

  const handleNewSession = () => {
    sessionStorage.removeItem("corpbank_conversation_id");
    sessionStorage.removeItem("corpbank_messages");
    sessionStorage.removeItem("corpbank_handoff_mode");
    window.location.reload();
  };

  return (
    <Card className="flex-1 flex flex-col mb-4 mr-4 ml-4">
      <CardContent className="flex-1 flex flex-col overflow-hidden pt-4 px-4 pb-0">
        <div className="flex items-start gap-2 pb-2">
          <div className="flex-1 min-w-0">
            <ConversationHeader
              selectedModel={selectedModel}
              setSelectedModel={setSelectedModel}
              models={models}
              showAvatar={showAvatar}
            />
          </div>
          {messages.length > 0 && (
            <button
              onClick={handleNewSession}
              className="text-xs text-muted-foreground border rounded px-2 py-1 hover:bg-muted whitespace-nowrap mt-1 shrink-0"
            >
              New session
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full animate-fade-in-up">
              <Avatar className="w-10 h-10 mb-4 border">
                <AvatarImage
                  src="/ant-logo.svg"
                  alt="AI Assistant Avatar"
                  width={40}
                  height={40}
                />
              </Avatar>
              <h2 className="text-2xl font-semibold mb-8">
                Here&apos;s how I can help
              </h2>
              <div className="space-y-4 text-sm">
                <div className="flex items-center gap-3">
                  <HandHelping className="text-muted-foreground" />
                  <p className="text-muted-foreground">
                    Need guidance? I&apos;ll help navigate tasks using internal
                    resources.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <WandSparkles className="text-muted-foreground" />
                  <p className="text-muted-foreground">
                    I&apos;m a whiz at finding information! I can dig through
                    your knowledge base.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <BookOpenText className="text-muted-foreground" />
                  <p className="text-muted-foreground">
                    I&apos;m always learning! The more you share, the better I
                    can assist you.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((message, index) => (
                <div key={message.id}>
                  <div
                    className={`flex items-start ${
                      message.role === "user" ? "justify-end" : ""
                    } ${
                      index === messages.length - 1 ? "animate-fade-in-up" : ""
                    }`}
                    style={{
                      animationDuration: "300ms",
                      animationFillMode: "backwards",
                    }}
                  >
                    {message.role === "assistant" && (
                      <Avatar className="w-8 h-8 mr-2 border">
                        <AvatarImage
                          src="/ant-logo.svg"
                          alt="AI Assistant Avatar"
                        />
                        <AvatarFallback>AI</AvatarFallback>
                      </Avatar>
                    )}
                    <div
                      className={`p-3 rounded-md text-sm max-w-[65%] ${
                        message.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted border"
                      }`}
                    >
                      <MessageContent
                        content={message.content}
                        role={message.role}
                      />
                    </div>
                  </div>
                  {message.role === "assistant" && !handoffMode && (
                    <SuggestedQuestions
                      questions={
                        JSON.parse(message.content).suggested_questions || []
                      }
                      onQuestionClick={handleSuggestedQuestionClick}
                      isLoading={isLoading}
                    />
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} style={{ height: "1px" }} />
            </div>
          )}
        </div>
      </CardContent>

      <CardFooter className="p-4 pt-0 flex-col gap-2">
        {handoffMode && (
          <div className="w-full flex items-center justify-between bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 text-sm">
            <span className="text-orange-700 font-medium">🧑‍💼 Connected to a human agent</span>
            <button
              type="button"
              onClick={async () => {
                await fetch("/api/handoff", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "customer_reply", conversation_id: conversationId, message: "__return_to_agent__" }),
                });
                setHandoffMode(false);
                setMessages((prev) => [...prev, {
                  id: crypto.randomUUID(),
                  role: "assistant",
                  content: JSON.stringify({
                    response: "You've been transferred back to the AI assistant.",
                    thinking: "", user_mood: "neutral", suggested_questions: [],
                    redirect_to_agent: { should_redirect: false }, debug: { context_used: false },
                  }),
                }]);
              }}
              className="text-xs text-orange-600 underline hover:text-orange-800"
            >
              Return to AI agent
            </button>
          </div>
        )}
        <form
          onSubmit={handleSubmit}
          className="flex flex-col w-full relative bg-background border rounded-xl focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"
        >
          <Textarea
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={chatClosed ? "This conversation has ended." : handoffMode ? "Message human agent..." : "Type your message here..."}
            disabled={isLoading || chatClosed}
            className="resize-none min-h-[44px] bg-background  border-0 p-3 rounded-xl shadow-none focus-visible:ring-0"
            rows={1}
          />
          <div className="flex justify-between items-center p-3">
            <div>
              <Image
                src="/claude-icon.svg"
                alt="Claude Icon"
                width={0}
                height={14}
                className="w-auto h-[14px] mt-1"
              />
            </div>
            <Button
              type="submit"
              disabled={isLoading || chatClosed || input.trim() === ""}
              className="gap-2"
              size="sm"
            >
              {isLoading ? (
                <div className="animate-spin h-5 w-5 border-t-2 border-white rounded-full" />
              ) : (
                <>
                  Send Message
                  <Send className="h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        </form>
      </CardFooter>
    </Card>
  );
}

export default ChatArea;

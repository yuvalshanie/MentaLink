"use client";

import { useState } from "react";
import { buildConversationPrompt } from "@/lib/conversation";
import { toFriendlyError } from "@/lib/clientErrors";

// Course-required GUI, now a minimal bounded chat: the user describes their
// situation, MentaLink may ask up to 2 short rounds of clarification
// questions, then returns recommendations. Conversation lives ONLY in React
// state (never persisted) and travels inside the existing `prompt` field of
// POST /api/execute. No auth.

const MODULE_ROLES = {
  UserRequestAnalyzer: "Understands your request",
  MatchmakerAgent: "Finds and explains matches",
  EthicalGuardianAgent: "Reviews for safety and honesty",
};

function LogoMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="7" cy="10" r="5.25" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="13" cy="10" r="5.25" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="8.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 6v5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="10" cy="14" r="1" fill="currentColor" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg
      className="trace-chevron"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 6l4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Home() {
  const [turns, setTurns] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [steps, setSteps] = useState(null);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  const started = turns.length > 0;

  function startOver() {
    setTurns([]);
    setInput("");
    setLoading(false);
    setSteps(null);
    setError(null);
    setDone(false);
  }

  async function send() {
    const text = input.trim();
    if (loading || done || text === "") return;
    const nextTurns = [...turns, { role: "user", text }];
    setTurns(nextTurns);
    setInput("");
    setLoading(true);
    setError(null);
    setSteps(null);
    try {
      const res = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: buildConversationPrompt(nextTurns) }),
      });
      const data = await res.json();
      if (data.status === "ok") {
        // A turn is terminal when the pipeline went past the analyzer
        // (recommendations or the crisis safety path).
        const terminal = (data.steps || []).some(
          (s) =>
            s.module === "MatchmakerAgent" || s.module === "EthicalGuardianAgent"
        );
        setTurns([
          ...nextTurns,
          {
            role: "assistant",
            text: data.response,
            kind: terminal ? "final" : "questions",
          },
        ]);
        setSteps(data.steps || []);
        setDone(terminal);
      } else {
        setError(toFriendlyError(data.error));
      }
    } catch {
      setError(
        "We could not reach the server. Please check your connection and try again."
      );
    } finally {
      setLoading(false);
    }
  }

  function onComposerKeyDown(e) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="shell">
      <header className="site-head">
        <div className="site-head-inner">
          <span className="brand">
            <LogoMark />
            MentaLink
          </span>
          <span className="brand-note">therapist discovery</span>
        </div>
      </header>

      <main className="content">
        <section className="hero">
          <h1>Find a therapist who fits what you&rsquo;re going through.</h1>
          <p className="lead">
            Describe it in your own words — no clinical language needed.
            MentaLink may ask a couple of short questions, then suggests up to
            three therapists and explains why each one might fit.
          </p>
        </section>

        {!started && (
          <section className="prompt-card" aria-label="Describe your request">
            <label className="prompt-label" htmlFor="prompt">
              What&rsquo;s on your mind
            </label>
            <textarea
              id="prompt"
              className="prompt-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onComposerKeyDown}
              rows={5}
              placeholder="Example: I've been feeling very anxious lately. I'm looking for a female therapist in Haifa, up to 300 per session."
              disabled={loading}
            />
            <div className="prompt-actions">
              <p className="prompt-hint">
                Include practical needs if you have them: city or region (e.g.
                the north), budget, therapist gender, preferred therapy style.
              </p>
              <button
                className="run-btn"
                onClick={send}
                disabled={loading || input.trim() === ""}
              >
                {loading && <span className="spinner" aria-hidden="true" />}
                {loading ? "Running…" : "Run Agent"}
              </button>
            </div>
          </section>
        )}

        {started && (
          <section className="chat-card" aria-label="Conversation">
            <ol className="chat-list">
              {turns.map((t, i) => (
                <li
                  key={i}
                  className={`chat-msg ${t.role === "user" ? "from-user" : "from-agent"}`}
                >
                  <span className="chat-who">
                    {t.role === "user" ? "You" : "MentaLink"}
                  </span>
                  <div className="chat-text">{t.text}</div>
                </li>
              ))}
            </ol>

            {loading && (
              <p className="loading-note" role="status">
                <span className="spinner" aria-hidden="true" />
                Working on it — this can take a little while.
              </p>
            )}

            {!done && !loading && (
              <div className="chat-composer">
                <label className="visually-hidden" htmlFor="answer">
                  Your answer
                </label>
                <textarea
                  id="answer"
                  className="prompt-input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onComposerKeyDown}
                  rows={3}
                  placeholder="Type your answer — you can also say “no preference” or skip a question."
                />
                <div className="chat-composer-actions">
                  <button
                    className="ghost-btn"
                    type="button"
                    onClick={startOver}
                  >
                    Start over
                  </button>
                  <button
                    className="run-btn"
                    onClick={send}
                    disabled={input.trim() === ""}
                  >
                    Send answer
                  </button>
                </div>
              </div>
            )}

            {done && (
              <div className="chat-composer-actions chat-done">
                <button className="run-btn" type="button" onClick={startOver}>
                  New search
                </button>
              </div>
            )}
          </section>
        )}

        {error && (
          <div className="error-card" role="alert">
            <ErrorIcon />
            <div>
              <h2>The agent couldn&rsquo;t finish</h2>
              <p>{error} You can adjust your message and try again.</p>
            </div>
          </div>
        )}

        {steps && (
          <section aria-labelledby="trace-heading" aria-live="polite">
            <div className="section-head">
              <h2 id="trace-heading">How this answer was made</h2>
              <p>
                Every model call behind the latest reply, in the order it ran.
                Open a step to see its exact prompts and response.
              </p>
            </div>
            {steps.length === 0 ? (
              <p className="trace-empty">
                No model calls were needed for this reply.
              </p>
            ) : (
              <ol className="trace">
                {steps.map((step, i) => (
                  <li className="trace-step" key={i}>
                    <span className="trace-marker" aria-hidden="true">
                      {i + 1}
                    </span>
                    <details open>
                      <summary>
                        <span className="trace-module">{step.module}</span>
                        <span className="trace-role">
                          {MODULE_ROLES[step.module] || "Model call"}
                        </span>
                        <Chevron />
                      </summary>
                      <div className="trace-body">
                        <h3>System prompt</h3>
                        <pre>{step.prompt?.System_prompt}</pre>
                        <h3>User prompt</h3>
                        <pre>{step.prompt?.User_prompt}</pre>
                        <h3>Response</h3>
                        <pre>{JSON.stringify(step.response, null, 2)}</pre>
                      </div>
                    </details>
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}
      </main>

      <footer className="site-foot">
        <div className="site-foot-inner">
          <p>
            MentaLink helps you discover therapist options. It doesn&rsquo;t
            diagnose, doesn&rsquo;t replace professional care, and isn&rsquo;t
            an emergency service — if you&rsquo;re in immediate danger, contact
            your local emergency services. Conversations stay in your browser
            and disappear when you refresh.
          </p>
        </div>
      </footer>
    </div>
  );
}

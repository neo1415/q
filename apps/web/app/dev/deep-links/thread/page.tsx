import { harnessThread } from "../fixtures";

/**
 * A thread's messages with the marker the real thread carries
 * (`data-q-message`, relationship-chat.tsx); `?message=` lands on one.
 */
export default function HarnessThread() {
  return (
    <>
      <h1 className="cq-title-md text-(--cq-text-primary)">Messages</h1>
      <ol className="flex flex-col gap-2" data-chat-thread>
        {harnessThread().map((message) => (
          <li
            key={message.id}
            data-q-message={message.id}
            className={`cq-body max-w-[72%] rounded-(--cq-radius-xl) border border-(--cq-border-subtle) px-3.5 py-2.5 ${message.mine ? "self-end" : "self-start"}`}
          >
            {message.text}
          </li>
        ))}
      </ol>
    </>
  );
}

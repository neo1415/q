"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { DialogContent, DialogRoot } from "@capital-q/ui/dialog";

import { QControl } from "@/features/q/control/q-control";

/** Long enough to scroll: the page's own list of companies. */
function Rows({ count }: { readonly count: number }) {
  return (
    <ol className="flex flex-col gap-2">
      {Array.from({ length: count }, (_, index) => (
        <li
          key={index}
          className="rounded-(--cq-radius-md) border border-(--cq-border-subtle) bg-(--cq-surface) p-4"
        >
          Company {index + 1}
        </li>
      ))}
    </ol>
  );
}

export function InstantNavFeed() {
  const [tab, setTab] = useState("for-you");
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState(false);
  const [pressed, setPressed] = useState<string[]>([]);
  return (
    <section className="flex flex-col gap-4 p-4" data-harness-page="feed">
      <h1 className="cq-title-md">Feed</h1>
      <div role="tablist" className="flex gap-2">
        {[
          ["for-you", "For you"],
          ["saved", "Saved"],
        ].map(([id = "", name = ""]) => (
          <QControl key={id} id={`tab.${id}`} kind="TAB">
            <button
              type="button"
              role="tab"
              aria-selected={tab === id}
              className="min-h-11 px-3"
              onClick={() => setTab(id)}
              data-harness-tab={id}
            >
              {name}
            </button>
          </QControl>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <QControl id="button.show-more" kind="BUTTON">
          <button
            type="button"
            className="min-h-11 px-3"
            aria-expanded={more}
            onClick={() => setMore((was) => !was)}
          >
            Show more
          </button>
        </QControl>
        <button
          type="button"
          className="min-h-11 px-3"
          onClick={() => setOpen(true)}
        >
          Notifications
        </button>
        <button
          type="button"
          className="min-h-11 px-3"
          onClick={() => setPressed((was) => [...was, "interest"])}
        >
          Express interest
        </button>
      </div>
      <p data-harness-pressed>{pressed.join(",")}</p>
      <p data-harness-more>{more ? "More shown" : ""}</p>
      <DialogRoot open={open} onOpenChange={setOpen}>
        {open ? (
          <DialogContent title="Notifications">
            <p>Nothing new.</p>
          </DialogContent>
        ) : null}
      </DialogRoot>
      <Rows count={40} />
    </section>
  );
}

const TABS = [
  ["overview", "Overview"],
  ["dataroom", "Data room"],
  ["deck", "Pitch deck"],
  ["team", "Team"],
] as const;

export function InstantNavCompany() {
  const search = useSearchParams();
  const tab = search.get("tab") ?? "overview";
  return (
    <section className="flex flex-col gap-4 p-4" data-harness-page="company">
      <h1 className="cq-title-md">Northwind Robotics</h1>
      <nav aria-label="Profile" className="flex flex-wrap gap-2">
        {TABS.map(([id, name]) => (
          <QControl key={id} id={`tab.${id}`} kind="TAB">
            <Link
              href={`?tab=${id}`}
              role="tab"
              aria-selected={tab === id}
              className="inline-flex min-h-11 items-center px-3"
              data-harness-tab={id}
            >
              {name}
            </Link>
          </QControl>
        ))}
      </nav>
      <p data-harness-selected>{tab}</p>
      <Rows count={30} />
    </section>
  );
}

export function InstantNavWork() {
  return (
    <section className="flex flex-col gap-4 p-4" data-harness-page="work">
      <h1 className="cq-title-md">Work</h1>
      <Rows count={8} />
    </section>
  );
}

"use client";

import { useEffect, useRef, type ReactNode } from "react";

import "./founder-tour.css";

/**
 * The GateQ draft on an investor's page, as the founder track fills it
 * (owner, 16 Oct: "fill it instantly, field by field"). The values are the
 * founder's own profile, already on the page; nothing is typed into a real
 * form, nothing is invented and nothing is sent. While the tour lights the
 * draft, its fields wait as quiet lines; as Q names each field, that field
 * and the ones before it appear, typed in. When the tour moves on, the
 * draft is simply the draft again. Read-only: it watches the tour's light.
 */
export function DraftFill({
  id,
  labelledBy,
  className,
  children,
}: {
  readonly id: string;
  readonly labelledBy: string;
  readonly className: string;
  readonly children: ReactNode;
}) {
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const section = root.current;
    if (section === null) return;
    const update = () => {
      const fields = [
        ...section.querySelectorAll<HTMLElement>("[data-qp-fill]"),
      ];
      const lit = section.hasAttribute("data-qp-lit")
        ? section
        : section.querySelector<HTMLElement>("[data-qp-lit]");
      if (lit === null) {
        section.removeAttribute("data-qp-filling");
        for (const field of fields) field.removeAttribute("data-qp-filled");
        return;
      }
      section.setAttribute("data-qp-filling", "");
      const reached =
        lit === section ? -1 : fields.findIndex((field) => field === lit);
      // Past the fields (the Send line): everything is filled.
      const upTo = lit !== section && reached === -1 ? fields.length : reached;
      fields.forEach((field, index) => {
        if (index <= upTo) field.setAttribute("data-qp-filled", "");
        else field.removeAttribute("data-qp-filled");
      });
    };
    const observer = new MutationObserver(update);
    observer.observe(section, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-qp-lit"],
    });
    return () => observer.disconnect();
  }, []);

  return (
    <section
      ref={root}
      id={id}
      aria-labelledby={labelledBy}
      className={className}
      data-qp-draft
      data-qp-anchor="fdr.08.gateq.draft"
    >
      {children}
    </section>
  );
}

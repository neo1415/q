import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Avatar } from "@capital-q/ui/avatar";
import { Badge } from "@capital-q/ui/badge";
import { Button, IconButton } from "@capital-q/ui/button";
import { Chip } from "@capital-q/ui/chip";
import { ContextIndicator } from "@capital-q/ui/context-indicator";
import { ArrowUp, ICON_SIZE, ICON_STROKE } from "@capital-q/ui/icons";
import { Input, Textarea } from "@capital-q/ui/input";
import { PriorityList } from "@capital-q/ui/priority-list";
import { QComposer } from "@capital-q/ui/q-composer";
import { QMark } from "@capital-q/ui/q-mark";
import { QStateIndicator } from "@capital-q/ui/q-state";
import {
  AccessUnavailable,
  EmptyState,
  ErrorState,
  InlineNotice,
  Progress,
  Skeleton,
} from "@capital-q/ui/states";
import { CONTEXT_SCOPES, Q_STATES } from "@capital-q/ui/tokens";

import {
  PageContainer,
  PageHeader,
  PageSection,
} from "@/components/app-shell/page-container";

import { DevOverlays } from "./dev-overlays";

export const metadata: Metadata = {
  title: "UI preview",
  robots: { index: false },
};

const TOKEN_GROUPS: readonly (readonly string[])[] = [
  ["canvas", "surface", "surface-raised", "surface-subtle", "surface-strong"],
  ["text-primary", "text-secondary", "text-tertiary", "text-inverse"],
  ["border-subtle", "border", "border-strong"],
  ["accent", "accent-hover", "accent-soft"],
  [
    "positive",
    "positive-soft",
    "warning",
    "warning-soft",
    "danger",
    "danger-soft",
    "info",
  ],
];

/**
 * Development-only design-system preview. Not a route in production builds:
 * it 404s there, and nothing here is reachable from product navigation.
 */
export default function UiPreviewPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <PageContainer>
      <PageHeader
        title="UI preview"
        description="Development-only view of the Capital Q design system."
      />
      <div className="flex flex-col gap-10">
        <PageSection id="tokens" title="Tokens">
          <div className="flex flex-col gap-3">
            {TOKEN_GROUPS.map((group) => (
              <div key={group[0]} className="flex flex-wrap gap-2">
                {group.map((token) => (
                  <div key={token} className="flex items-center gap-2">
                    <span
                      className="size-8 rounded-sm border border-(--cq-border-subtle)"
                      style={{ background: `var(--cq-${token})` }}
                    />
                    <code className="cq-caption font-mono text-(--cq-text-secondary)">
                      --cq-{token}
                    </code>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </PageSection>

        <PageSection id="type" title="Type roles">
          <div className="flex flex-col gap-2">
            <p className="cq-display">Display 34/40</p>
            <p className="cq-title-xl">Title XL 28/32</p>
            <p className="cq-title-lg">Title LG 24/26</p>
            <p className="cq-title-md">Title MD 20/21</p>
            <p className="cq-body-lg">Body LG 17</p>
            <p className="cq-body">Body 16/15</p>
            <p className="cq-body-sm">Body SM 14</p>
            <p className="cq-label">Label 13</p>
            <p className="cq-caption">Caption 12</p>
            <p className="cq-body cq-numeric">
              Numeric 1,240,000.00 · 2.4M · 12.5%
            </p>
          </div>
        </PageSection>

        <PageSection id="buttons" title="Buttons">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="quiet">Quiet</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="primary" disabled>
              Disabled
            </Button>
            <Button variant="secondary" size="compact">
              Compact
            </Button>
            <Button variant="primary" size="large">
              Large
            </Button>
            <IconButton aria-label="Send" variant="primary">
              <ArrowUp
                aria-hidden="true"
                size={ICON_SIZE.prominent}
                strokeWidth={ICON_STROKE}
              />
            </IconButton>
          </div>
        </PageSection>

        <PageSection id="fields" title="Fields">
          <div className="flex max-w-(--cq-layout-narrow) flex-col gap-4">
            <Input
              id="dev-name"
              label="Organisation name"
              placeholder="Apex Ventures"
            />
            <Input
              id="dev-error"
              label="Website"
              defaultValue="not a url"
              error="Enter a full address, including https://"
            />
            <Textarea
              id="dev-notes"
              label="Notes"
              description="Grows with what you write."
              placeholder="A few sentences are enough."
            />
          </div>
        </PageSection>

        <PageSection id="chips" title="Chips, badges, avatar">
          <div className="flex flex-wrap items-center gap-3">
            <Chip>Seed</Chip>
            <Chip>Series A</Chip>
            <Badge>Draft</Badge>
            <Badge tone="accent">Self-reported</Badge>
            <Badge tone="positive">Verified</Badge>
            <Badge tone="warning">Stale</Badge>
            <Badge tone="danger">Disputed</Badge>
            <Avatar name="Apex Ventures" shape="square" />
            <Avatar name="Dana Okafor" />
          </div>
        </PageSection>

        <PageSection id="context" title="Context indicator">
          <div className="flex flex-wrap gap-2">
            {CONTEXT_SCOPES.map((scope) => (
              <ContextIndicator key={scope} scope={scope} />
            ))}
          </div>
        </PageSection>

        <PageSection id="q" title="Q">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              {Q_STATES.map((state) => (
                <QMark key={state} state={state} />
              ))}
            </div>
            <div className="flex flex-col gap-3">
              {Q_STATES.map((state) => (
                <QStateIndicator
                  key={state}
                  state={state}
                  detail={
                    state === "WORKING" ? "Reviewing evidence" : undefined
                  }
                />
              ))}
            </div>
            <QComposer />
          </div>
        </PageSection>

        <PageSection id="states" title="States">
          <div className="flex flex-col gap-4">
            <InlineNotice tone="info" title="Heads up">
              Informational notice with calm tone.
            </InlineNotice>
            <InlineNotice tone="warning">
              A warning that reads as guidance.
            </InlineNotice>
            <InlineNotice tone="danger" title="Couldn't save">
              Try again in a moment.
            </InlineNotice>
            <EmptyState
              title="Nothing here yet."
              description="An explanation, and one action."
            />
            <ErrorState
              title="This didn't load."
              description="The connection dropped before the response arrived."
              action={<Button variant="secondary">Try again</Button>}
            />
            <AccessUnavailable />
            <Skeleton lines={3} />
            <Progress label="Uploading deck" value={62} />
            <Progress label="Preparing" />
            <PriorityList state="loading" />
          </div>
        </PageSection>

        <PageSection id="overlays" title="Overlays">
          <DevOverlays />
        </PageSection>
      </div>
    </PageContainer>
  );
}

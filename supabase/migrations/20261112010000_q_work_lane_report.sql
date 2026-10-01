-- AUTO (ADR 0029): the first-stage interview report lives with its lane.
--
-- A Q document (q_runtime.artifacts) is prepared inside a Q run under the
-- Context Firewall's plan for that run; delegated work runs outside any
-- conversation, so its report is kept here, read only by the investor
-- whose delegation it is, and rendered to PDF on request.

alter table q_runtime.delegation_lanes
  add column report jsonb check (
    report is null or (jsonb_typeof(report) = 'object' and length(report::text) <= 40000)),
  add column report_at timestamptz,
  add constraint delegation_lanes_report_at check ((report is null) = (report_at is null));

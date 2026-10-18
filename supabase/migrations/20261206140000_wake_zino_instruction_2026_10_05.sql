-- Fix forward (lead 2026-10-05): Zino's standing instruction ("express
-- interest as soon as any company matches my mandate") last ran at 09:08,
-- before Spheros became marketplace-ready at 09:53; its next scheduled run
-- was 13:08. Bring that run forward so the scheduler picks it up on its next
-- tick. Nothing else changes: the approved grant, its AUTO/ASK modes and its
-- working hours still decide what Q does. A no-op unless still ACTIVE.

update q_runtime.standing_instructions
   set next_fire_at = clock_timestamp()
 where id = '54e6dba6-2b61-4e2c-84ce-26ce27a7e1b8'
   and status = 'ACTIVE';

---
name: verify-from-requirements
description: Derive and execute application checks from the platform requirements during the current model run, then repair demonstrated defects.
---

# Verify from requirements

Use this procedure during implementation and final verification. The platform
requirements, reference materials and inherited application supply the task facts.
This skill supplies no task-specific cases, selectors, fixture values or solutions.

## Derive checks

For the assigned scope, record a concise coverage map in `.evolution/coverage.md`:
requirement identifier, required observable outcome, test command or test location,
and latest observed result. Keep one shared map across implementation batches.
Distinguish specified behavior from your assumptions; reread the requirement when
an assertion depends on an assumption. Do not invent an interface requirement.

Derive preconditions, actions and expected outcomes from the supplied requirement.
Where the requirement defines them, cover successful operations, rejected
operations, persistent state and permissions. Add a small variation of input or
identity to check that the implementation follows the rule rather than the example.
Do not obtain cases or implementation hints from external artifacts or prior runs.

## Generate concrete cases inside this run

For each selected check, derive these fields from the supplied requirement before
writing code: source requirement, initial state, actor, action, expected visible
result, expected stored state, and state that must remain unchanged. Cite the
requirement identifier or relevant passage in the coverage map. The implementation
can explain how to interact with the app; it cannot be the sole oracle for what is
correct. Do not copy an implementation's wrong behavior into the expected result.

Choose applicable case families rather than applying every family to every feature:

- Ordinary success: use the documented workflow and verify its actual result.
- Boundary: if the specification defines a limit N, derive cases just below, at
  and above N. Do not invent a limit that the specification does not define.
- Invalid input: derive missing, malformed or conflicting inputs from the stated
  validation rules. Check both the error and the absence of unintended writes.
- Alternate valid input: create a fresh name, value or record through supported
  actions; compute the expectation from the rule rather than a fixed example.
- Identity or visibility: where roles are specified, exercise an allowed actor and
  a disallowed actor using separate sessions and the same target operation.
- Persistence: where state must persist, reload or reopen and verify the saved
  state. Test a server restart only when relevant to the requirement or defect.
- State transition: check the required before/after states and any specified
  reversible operation; do not assume an operation is reversible when unspecified.

Literal example values, exact messages and expected labels must come from the
platform materials. Additional input variations may be invented during this run,
but their expected outcomes must follow those materials. When behavior is genuinely
unspecified, record that gap rather than turning a guess into a required assertion.

## Derive selectors from the actual interface

Start from the documented user entry point. Identify the semantic role, accessible
name, containing region and page state needed for each action. Where the requirement
specifies a label or role, assert it; do not silently accept a different interface.
For unspecified details, inspect the rendered page and choose a stable user-facing
locator. Prefer relevant form, dialog or page regions over positional selection.

If a locator matches several controls, determine whether the scope is wrong or the
interface is ambiguous. Do not hide the ambiguity by selecting the first match.
If an action navigates, wait for observable evidence of the destination before
operating on fields that may also exist on the previous page. Exercise controls
according to their actual semantics. Do not substitute DOM injection, forced clicks
or direct storage edits for a user interaction required by the specification.

Do not treat visible text as sufficient evidence of an accessible error or control.
Inspect semantic roles and associated labels as well as appearance. Prefer native
HTML controls where they implement the required interaction; a custom control must
preserve equivalent accessibility, focus and keyboard behavior. Derive the concrete
controls and assertions from the current platform specification, not prior reports.

Test a workflow's individual transitions before combining them into a long scenario.
A test must not silently add prerequisite actions that the documented sequence does
not require. Where the supplied materials describe multiple entry points for the
same capability, verify their common behavior and required differences. Record
contradictions or unspecified details explicitly; do not invent a hidden contract.

## Common failure patterns to investigate when relevant

These are diagnostic possibilities, not additional product requirements or a
mandatory full regression suite. Select the rows supported by the current feature
or observed failure and generate the concrete checks yourself.

| Symptom | Investigation and useful evidence |
| --- | --- |
| A control cannot be found | Confirm navigation completed, the actor has the required access, and the role/name/scope matches the contract. Distinguish a missing feature from a bad locator. |
| Tests work only through a direct URL | Follow the documented entry path and inspect whether navigation actually exposes the implemented feature. |
| Saving appears successful but reload loses data | Trace the submitted payload, response and subsequent read. Verify the saved state rather than a temporary UI update. |
| Invalid input shows an error but changes data | Compare state before and after the rejected operation, including related records. Inspect validation placement and transaction boundaries. |
| One field's update changes another record | Use independently created records and inspect identifier, ownership and parent-child scoping. |
| A dependent display is stale | Change the underlying input through a supported action and derive the new expected result from the specification; inspect invalidation and recomputation. |
| Fast consecutive actions lose changes | Reproduce the actual sequence and collect request/response evidence. Inspect ordering and shared-state updates rather than adding arbitrary sleeps. |
| A denied action still succeeds | Check server-side authorization and persisted state with separate sessions; hiding a control alone is insufficient. |
| The first request fails but later requests work | Inspect application readiness and initialization dependencies. Verify required startup data is available when the app declares itself ready. |
| A test passes alone but fails with other tests | Inspect shared data, session state, cleanup and case order. Isolate setup without bypassing behavior under test. |
| A correct-looking screen fails interaction | Inspect accessible roles, labels, focus and required keyboard behavior. Visual similarity alone does not establish usability. |
| A build passes but the app cannot run | Start it using the required launch contract and verify frontend/API availability; distinguish runtime setup from model-generation errors. |

## Write and execute

Reuse relevant platform-provided tests and helpers. Author any missing tests now,
using the application's existing tools and actual behavior. For user-visible
requirements, exercise real browser navigation and controls. Derive selectors
from the public contract and rendered accessibility information. API checks may
supplement browser coverage; do not substitute them for a required UI interaction.

Treat every existing test suite covering pre-existing or assigned behavior as a
regression gate. Inventory it before editing tests. Keep its files, scenarios,
assertions and setup; do not delete, rename, weaken, skip or replace it with a
smaller feature-only suite. Add new checks beside it and make the final runner
execute both inherited suites and new requirement checks. If runtime is long, run
suites in batches with fresh disposable data and still run every batch before
declaring verification complete. A new suite passing while an inherited suite is
absent or failing is incomplete evidence.

Use isolated test data. If the specification requires startup records, implement
their provisioning in the application and verify they exist before acting; do not
silently manufacture them inside tests. Tests may create ordinary new records via
public application actions when that is their stated setup. Avoid editing the
original platform database or coupling one case to an unrelated case's mutations.

Execute checks, record the real exit status and observable failures, and distinguish
application defects from test-infrastructure errors or unsupported assumptions.
Repair the root cause. Never reduce assertions or suppress errors to report a pass.
If a test assumption was wrong, correct it against the requirement and document why.

For a failure, record the action, expected outcome, observed outcome and the smallest
relevant log or request evidence. Identify whether it is a product defect, a test
defect, an environment failure or an unresolved specification question before
repairing. Reproduce once, inspect the responsible implementation and its callers,
then change the shared cause. Keep the failed case as a regression check when its
assertion follows the requirement. Do not claim a fix based only on edited source.

## Finish without unnecessary calls

Perform a final review in a fresh model session. First read the complete platform
requirements and derive a short independent checklist without reading the existing
tests or implementation reports. Then compare it with the generated tests and
actual rendered interface. Look for assertions adapted to the implementation,
missing rejection checks, inaccessible controls and extra setup actions masking
incomplete workflows. Author and execute only the missing checks warranted by this
review. A green self-test suite alone is not evidence that the specification is met.

After a change, rerun the failed checks and those affected by that change. Reuse
passing evidence when unrelated code is unchanged, but run the complete inherited
regression gate before the final report. Summarize remaining gaps instead of
duplicating test suites or repeatedly rerunning everything without a reason.

At final verification, assemble checks authored in this run and all relevant inherited
checks into `.evolution/self-check.sh`. It runs with bash from the application root,
returns nonzero on failure, prints a concise result summary and cleans up temporary
servers. Report discovered/executed/passed/failed/skipped counts for each suite where
the test tool supports them; list every discovered suite and command. If `ARC_CHECK_INITIAL_DB` is supplied, test on a disposable copy. The runner
does not receive model credentials. Build the application, execute the runner and
update the coverage map from actual results. Follow the harness's bounded repair
budget; report unresolved defects and untested requirements honestly.

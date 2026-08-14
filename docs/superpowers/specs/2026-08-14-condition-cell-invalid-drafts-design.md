# Condition cell invalid drafts — design specification

Date: 2026-08-14  
Status: Approved in conversation  
Target: PCM project condition Sheet

## 1. Job and audience

Process engineers edit dense condition Sheets for long sessions, primarily by keyboard. When a
cell value is invalid, PCM must explain what is wrong without deleting the engineer's input,
changing the Grid's row geometry, or allowing the invalid value to reach the server.

The primary outcome is that an engineer can see the rejected input, understand the exact repair,
move elsewhere without losing context, and later return to fix it. Success means invalid input is
never mistaken for saved data and never forces the user to reconstruct what they typed.

## 2. Selected interaction direction

PCM uses an anchored error popover for the currently active invalid cell.

- The cell retains the user's exact input string.
- A red inset border and error marker identify the invalid cell without changing row height.
- The active invalid cell opens a compact popover anchored to that cell.
- Moving to another cell closes only the popover; the invalid draft and cell marker remain.
- Returning to or reopening the invalid cell shows the popover again.
- Correcting the value removes the invalid state and hands the value to the existing save flow.

This direction preserves the continuous drafting-table geometry. Inline expanding errors would
move row coordinates, while a right-side error rail would compete with validation, history, and
Backbone evidence.

## 3. State ownership and data contract

The existing Sheet edit store owns invalid drafts. No second store, React context, state machine,
server endpoint, or database field is introduced.

Each invalid draft contains only the information needed to render and repair one cell:

- condition ID and parameter ID;
- the exact user-entered string;
- the existing validation error code;
- concise problem and repair text derived from the validation result.

Invalid drafts are session-local UI state. They are not dirty values eligible for persistence and
must never enter autosave, retry, reconciliation, or cell mutation payloads. The existing saved or
valid-dirty value remains the persistence authority beneath the invalid display draft.

### Single-cell edit flow

1. The user commits a candidate value.
2. PCM runs the existing single-cell validator.
3. If valid, PCM removes any invalid draft for the coordinate and sends the normalized value
   through the existing dirty/save path exactly once.
4. If invalid, PCM stores the raw candidate as an invalid draft and performs no server mutation.
5. A Sheet query refresh may replace server data but does not erase invalid drafts during the
   mounted Sheet session.
6. Confirmed navigation away from the Sheet or Sheet unmount discards invalid drafts. Reloading or
   re-entering the Sheet therefore shows the last server-backed value.

The invalid-draft coordinate must follow the same condition/parameter identity used by existing
edits rather than a viewport row or column index.

## 4. Grid presentation and accessibility

The Grid continues to use its pre-existing fixed 32px rows. An invalid cell displays its raw draft
rather than the saved value and adds:

- a 2px red inset boundary;
- a non-color error marker;
- an accessible description containing the problem and the phrase `저장되지 않음`.

Only the active invalid cell owns a visible popover. It prefers placement below the cell and flips
above when there is insufficient viewport space. It must stay inside the supported desktop
viewport and must not obscure the edited value. It has no close button; focus movement controls
its visibility.

The popover follows the product copy rule `problem + constraint + state + next action` and is
limited to four short lines:

1. the problem;
2. the accepted constraint when one exists;
3. `입력값은 저장되지 않았습니다`;
4. `값을 수정하면 저장됩니다`.

Representative messages:

- invalid numeric form: `숫자로 입력하세요`;
- numeric bounds: `0–500 kPa 범위로 입력하세요`;
- required value: `필수값을 입력하세요`;
- invalid Choice value: `목록에서 사용할 수 있는 값을 선택하세요`.

Choice resource loading failures are not invalid drafts. PCM keeps the existing blocked-editor
behavior and explains that the choice list could not be loaded.

The accessible cell name or description must include the Layer/condition/parameter coordinate,
raw draft, error explanation, and unsaved state. Color alone must never carry the error meaning.

## 5. Keyboard and focus behavior

- Enter or the existing edit gesture opens the editor with the current displayed value selected.
- Committing an invalid value leaves the active coordinate on that cell and opens its popover.
- Tab, Shift+Tab, and supported arrow navigation may move away; movement closes the popover but
  preserves the invalid draft.
- Selecting or editing an invalid cell again reopens its popover.
- Escape cancels the current editing gesture and restores the value that existed before that
  gesture. It does not erase invalid drafts in other cells.
- Read-only or lock-lost Sheets cannot create, modify, or clear invalid drafts through editing.

Multiple invalid drafts may exist, but only one popover is visible at a time.

## 6. Navigation protection

Invalid drafts participate in the existing unsaved-changes navigation guard even though they are
excluded from persistence. The guard treats `valid dirty edits OR invalid drafts` as unsaved work.

- Canceling navigation preserves all invalid drafts and returns focus to the Sheet workflow.
- Confirming navigation discards invalid drafts as the Sheet is left.
- Browser reload and later re-entry restore server-backed values; invalid drafts are not written to
  local storage or another durable cache.

Existing valid dirty edits keep their current save/reconciliation semantics. This slice must not
weaken or duplicate the current guard.

## 7. Scope boundaries

Included:

- text, decimal/number, required, bounds, and Choice single-cell validation failures;
- invalid raw-value rendering, marker, active-cell popover, accessibility, and navigation guard;
- existing desktop targets at 1024px, 1440px, and 1920px.

Explicitly excluded:

- server or database changes;
- durable recovery after reload or re-entry;
- a new validation panel, right-side rail, or inline expanding row;
- changes to validation/history/Backbone workbench content;
- changes to bulk paste, which retains its existing atomic validation/rejection behavior;
- mobile Sheet editing;
- unrelated Grid editor or visual-system redesign.

## 8. Error and edge-state rules

- An invalid draft always wins display precedence over its saved or valid-dirty value at the same
  coordinate, but never wins persistence precedence.
- A subsequent valid edit clears the invalid draft before entering the save flow.
- A Sheet refresh must not silently clear a session's invalid drafts.
- Row filtering, current-Layer mode, and virtual scrolling may temporarily hide an invalid cell;
  hiding it does not discard the draft or navigation warning.
- Deleted conditions or removed parameters cannot retain orphan invalid drafts after the owning
  coordinate disappears from authoritative Sheet data.
- Save failure for a later valid correction follows the existing dirty-save failure behavior; it
  must not be mislabeled as an invalid-input error.

## 9. Verification contract

Tests must prove:

- raw invalid input remains visible for numeric form, bounds, required, and Choice failures;
- invalid input never invokes the cell persistence callback or API mutation;
- a valid correction clears the draft and enters the existing persistence path exactly once;
- moving focus closes the popover but preserves the cell draft and marker;
- returning to the cell reopens the popover;
- Escape restores the pre-gesture display value;
- invalid drafts participate in navigation protection, survive a canceled navigation, and are
  discarded by confirmed departure;
- Sheet query refresh preserves drafts, while removed coordinates are pruned;
- read-only and lost-lock states cannot create invalid drafts;
- accessible output states the coordinate, error, and unsaved status;
- only the affected cell/editor state changes, preserving Glide virtualization and dense-grid
  performance.

Browser verification covers 1024px, 1440px, and 1920px with at least one lower-edge cell to prove
popover flipping and zero document-level horizontal overflow. The Impeccable mechanical detector
runs once after the UI implementation is final.

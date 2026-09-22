# Issue tracker: Linear

Track this repository's work in the Bleu Builders workspace, Web3 Deals project, at this configured milestone:

https://linear.app/bleu-builders/project/web3-deals-a5e6ddb5d475/overview#milestone-6ef4fdcd-b796-4111-b482-9485d74579b2

The URL is supplied by the maintainer. Resolve the project's internal ID, owning team, and milestone through the connected Linear integration before publishing. The milestone reference from the URL is `6ef4fdcd-b796-4111-b482-9485d74579b2`; its display name has not yet been verified.

## Workflow

- When a skill says to publish to the issue tracker, create a Linear issue in this project and milestone using the connected Linear integration.
- When a skill says to fetch a ticket, retrieve its description, status, labels, and comments by issue identifier or URL.
- Search this project for related issues before creating new ones. Include the relevant repository paths and ADR links in implementation tickets.
- Resolve Linear team and workflow status IDs before changing issue state. Map triage labels using `docs/agents/triage-labels.md`; labels are distinct from workflow statuses.
- If an integration cannot set the milestone during creation, use its supported update operation and verify the resulting project and milestone.
- If Linear access is unavailable, prepare a local draft and report it as unpublished. Resume publication when access is available. Do not silently publish to GitHub or substitute a different project or milestone.

These conventions define where authorized issue-tracker actions happen; they do not themselves request publication or external comments.

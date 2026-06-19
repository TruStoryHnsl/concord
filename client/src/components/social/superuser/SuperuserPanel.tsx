/**
 * Component home: **superuser-ux** (OWNED by the superuser-ux branch).
 *
 * First-run / owner setup UX, owner-profile claim, and owner controls for
 * the social graph. The superuser-ux branch owns everything under
 * `client/src/components/social/superuser/`. Base branch ships this
 * placeholder so the directory + import path exist and the build compiles.
 */
import { socialOwnerGet } from "../../../api/social/superuser";

export function SuperuserPanel() {
  // Reference the owned api so the import isn't tree-shaken away and the
  // contract is exercised at type-check time. Replaced by the real flow.
  void socialOwnerGet;
  return null;
}

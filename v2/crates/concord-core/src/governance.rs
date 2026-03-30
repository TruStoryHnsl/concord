//! Governance protocol for Places.
//!
//! Two governance models:
//! - **Private**: Owner has absolute control. Admin hierarchy is authoritarian.
//! - **Public**: Responsibility-based hierarchy. Communal voting can override admin.
//!
//! Voting eligibility requirements for public places:
//! - Account age >= 30 days
//! - "Confirmed human" reputation tag (ruc_score > 0.5)
//! - 2FA configured on the account
//!
//! Votes are local decisions — each node tallies independently from its own mesh map data.

use serde::{Deserialize, Serialize};

use crate::mesh_map::{GovernanceModel, MeshAddress, MeshTimestamp, PlaceRole};

// ─── Vote Proposals ────────────────────────────────────────────────

/// A proposal that members of a public place can vote on.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoteProposal {
    /// Unique proposal ID.
    pub id: String,
    /// The place this proposal belongs to.
    pub place_address: MeshAddress,
    /// Who created this proposal (must have Member+ role).
    pub proposer_id: String,
    /// What action is being proposed.
    pub action: ProposalAction,
    /// Human-readable description.
    pub description: String,
    /// When the proposal was created (unix millis).
    pub created_at: MeshTimestamp,
    /// When voting closes (unix millis). Default: 72 hours after creation.
    pub expires_at: MeshTimestamp,
    /// Current status.
    pub status: ProposalStatus,
}

/// Default voting window: 72 hours.
pub const DEFAULT_VOTE_DURATION_MS: u64 = 72 * 60 * 60 * 1000;

/// Actions that can be proposed for a vote.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ProposalAction {
    /// Promote a member to a new role.
    PromoteRole { peer_id: String, new_role: PlaceRole },
    /// Demote a member to a lower role.
    DemoteRole { peer_id: String, new_role: PlaceRole },
    /// Remove a member from the place.
    RemoveMember { peer_id: String },
    /// Change the place's name.
    ChangeName { new_name: String },
    /// Change visibility (public/private).
    ChangeVisibility { new_visibility: String },
    /// Override an admin decision (communal override).
    OverrideAdmin { description: String },
    /// Custom action (free-form, for extensions).
    Custom { action_type: String, data: String },
}

/// Status of a proposal.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ProposalStatus {
    /// Voting is open.
    Open,
    /// Voting closed, proposal passed.
    Passed,
    /// Voting closed, proposal rejected.
    Rejected,
    /// Voting closed, not enough participants (quorum not met).
    NoQuorum,
    /// Proposal was cancelled by the proposer or an admin.
    Cancelled,
}

// ─── Vote Casting ──────────────────────────────────────────────────

/// A single vote cast by an eligible member.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vote {
    /// The proposal being voted on.
    pub proposal_id: String,
    /// Who cast this vote.
    pub voter_id: String,
    /// The vote choice.
    pub choice: VoteChoice,
    /// When the vote was cast (unix millis).
    pub cast_at: MeshTimestamp,
    /// Ed25519 signature over (proposal_id || voter_id || choice || cast_at).
    pub signature: Vec<u8>,
}

/// Vote choices.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum VoteChoice {
    Approve,
    Reject,
    Abstain,
}

// ─── Eligibility ───────────────────────────────────────────────────

/// Eligibility criteria for voting in a public place.
#[derive(Debug, Clone)]
pub struct VoterEligibility {
    /// Account age in milliseconds (must be >= MIN_ACCOUNT_AGE_MS).
    pub account_age_ms: u64,
    /// Real-user-confidence score (must be > RUC_THRESHOLD).
    pub ruc_score: f64,
    /// Whether 2FA is enabled on the account.
    pub has_2fa: bool,
    /// Role in the place (must be >= Member).
    pub role: PlaceRole,
}

/// Minimum account age for voting: 30 days.
pub const MIN_ACCOUNT_AGE_MS: u64 = 30 * 24 * 60 * 60 * 1000;

/// Minimum real-user-confidence score for voting.
pub const RUC_THRESHOLD: f64 = 0.5;

/// Minimum quorum: percentage of eligible voters that must participate.
pub const QUORUM_PERCENT: f64 = 0.25;

/// Approval threshold: percentage of non-abstain votes that must approve.
pub const APPROVAL_THRESHOLD: f64 = 0.5;

impl VoterEligibility {
    /// Check if this voter meets all eligibility requirements.
    pub fn is_eligible(&self) -> bool {
        self.account_age_ms >= MIN_ACCOUNT_AGE_MS
            && self.ruc_score > RUC_THRESHOLD
            && self.has_2fa
            && self.role >= PlaceRole::Member
    }
}

// ─── Tally ─────────────────────────────────────────────────────────

/// Result of tallying votes on a proposal.
#[derive(Debug, Clone)]
pub struct VoteTally {
    pub approve: u32,
    pub reject: u32,
    pub abstain: u32,
    pub eligible_voters: u32,
    pub quorum_met: bool,
    pub passed: bool,
}

/// Tally votes and determine the outcome.
pub fn tally_votes(votes: &[Vote], eligible_voter_count: u32) -> VoteTally {
    let mut approve = 0u32;
    let mut reject = 0u32;
    let mut abstain = 0u32;

    for vote in votes {
        match vote.choice {
            VoteChoice::Approve => approve += 1,
            VoteChoice::Reject => reject += 1,
            VoteChoice::Abstain => abstain += 1,
        }
    }

    let total_cast = approve + reject + abstain;
    let quorum_met = eligible_voter_count > 0
        && (total_cast as f64 / eligible_voter_count as f64) >= QUORUM_PERCENT;

    let non_abstain = approve + reject;
    let passed =
        quorum_met && non_abstain > 0 && (approve as f64 / non_abstain as f64) >= APPROVAL_THRESHOLD;

    VoteTally {
        approve,
        reject,
        abstain,
        eligible_voters: eligible_voter_count,
        quorum_met,
        passed,
    }
}

// ─── Permission Checks ────────────────────────────────────────────

/// Check if a role can perform an action in a place.
pub fn can_perform(
    role: PlaceRole,
    governance: &GovernanceModel,
    action: &PlaceAction,
) -> bool {
    match governance {
        GovernanceModel::Private => {
            // Private: strict hierarchy, no communal override
            match action {
                PlaceAction::SendMessage => role >= PlaceRole::Member,
                PlaceAction::CreateChannel => role >= PlaceRole::Admin,
                PlaceAction::DeleteChannel => role >= PlaceRole::Admin,
                PlaceAction::KickMember => role >= PlaceRole::Moderator,
                PlaceAction::BanMember => role >= PlaceRole::Admin,
                PlaceAction::ChangeSettings => role >= PlaceRole::Admin,
                PlaceAction::TransferOwnership => role >= PlaceRole::Owner,
                PlaceAction::CreateProposal => false, // no proposals in private places
                PlaceAction::CastVote => false,
            }
        }
        GovernanceModel::Public => {
            // Public: similar base permissions, but proposals can override
            match action {
                PlaceAction::SendMessage => role >= PlaceRole::Member,
                PlaceAction::CreateChannel => role >= PlaceRole::Admin,
                PlaceAction::DeleteChannel => role >= PlaceRole::Admin,
                PlaceAction::KickMember => role >= PlaceRole::Moderator,
                PlaceAction::BanMember => role >= PlaceRole::Admin,
                PlaceAction::ChangeSettings => role >= PlaceRole::Admin,
                PlaceAction::TransferOwnership => role >= PlaceRole::Owner,
                PlaceAction::CreateProposal => role >= PlaceRole::Member,
                PlaceAction::CastVote => role >= PlaceRole::Member,
            }
        }
    }
}

/// Actions that can be performed in a place.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlaceAction {
    SendMessage,
    CreateChannel,
    DeleteChannel,
    KickMember,
    BanMember,
    ChangeSettings,
    TransferOwnership,
    CreateProposal,
    CastVote,
}

// ─── Tests ─────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eligible_voter() {
        let e = VoterEligibility {
            account_age_ms: MIN_ACCOUNT_AGE_MS + 1,
            ruc_score: 0.8,
            has_2fa: true,
            role: PlaceRole::Member,
        };
        assert!(e.is_eligible());
    }

    #[test]
    fn ineligible_too_young() {
        let e = VoterEligibility {
            account_age_ms: MIN_ACCOUNT_AGE_MS - 1,
            ruc_score: 0.8,
            has_2fa: true,
            role: PlaceRole::Member,
        };
        assert!(!e.is_eligible());
    }

    #[test]
    fn ineligible_no_2fa() {
        let e = VoterEligibility {
            account_age_ms: MIN_ACCOUNT_AGE_MS + 1,
            ruc_score: 0.8,
            has_2fa: false,
            role: PlaceRole::Member,
        };
        assert!(!e.is_eligible());
    }

    #[test]
    fn ineligible_low_ruc() {
        let e = VoterEligibility {
            account_age_ms: MIN_ACCOUNT_AGE_MS + 1,
            ruc_score: 0.3,
            has_2fa: true,
            role: PlaceRole::Member,
        };
        assert!(!e.is_eligible());
    }

    #[test]
    fn ineligible_guest_role() {
        let e = VoterEligibility {
            account_age_ms: MIN_ACCOUNT_AGE_MS + 1,
            ruc_score: 0.8,
            has_2fa: true,
            role: PlaceRole::Guest,
        };
        assert!(!e.is_eligible());
    }

    #[test]
    fn tally_simple_pass() {
        let votes = vec![
            make_vote("a", VoteChoice::Approve),
            make_vote("b", VoteChoice::Approve),
            make_vote("c", VoteChoice::Reject),
        ];
        let tally = tally_votes(&votes, 4); // 3 of 4 voted = 75% > 25% quorum
        assert!(tally.quorum_met);
        assert!(tally.passed); // 2 approve vs 1 reject = 66% > 50%
        assert_eq!(tally.approve, 2);
        assert_eq!(tally.reject, 1);
    }

    #[test]
    fn tally_simple_reject() {
        let votes = vec![
            make_vote("a", VoteChoice::Reject),
            make_vote("b", VoteChoice::Reject),
            make_vote("c", VoteChoice::Approve),
        ];
        let tally = tally_votes(&votes, 4);
        assert!(tally.quorum_met);
        assert!(!tally.passed); // 1 approve vs 2 reject = 33% < 50%
    }

    #[test]
    fn tally_no_quorum() {
        let votes = vec![make_vote("a", VoteChoice::Approve)];
        let tally = tally_votes(&votes, 10); // 1 of 10 = 10% < 25% quorum
        assert!(!tally.quorum_met);
        assert!(!tally.passed);
    }

    #[test]
    fn tally_abstains_dont_count() {
        let votes = vec![
            make_vote("a", VoteChoice::Approve),
            make_vote("b", VoteChoice::Abstain),
            make_vote("c", VoteChoice::Abstain),
        ];
        let tally = tally_votes(&votes, 4); // 3 of 4 voted = quorum met
        assert!(tally.quorum_met);
        assert!(tally.passed); // 1 approve vs 0 reject = 100% > 50%
    }

    #[test]
    fn private_place_no_proposals() {
        assert!(!can_perform(
            PlaceRole::Owner,
            &GovernanceModel::Private,
            &PlaceAction::CreateProposal,
        ));
    }

    #[test]
    fn public_place_members_can_propose() {
        assert!(can_perform(
            PlaceRole::Member,
            &GovernanceModel::Public,
            &PlaceAction::CreateProposal,
        ));
    }

    #[test]
    fn guest_cannot_send_message() {
        assert!(!can_perform(
            PlaceRole::Guest,
            &GovernanceModel::Private,
            &PlaceAction::SendMessage,
        ));
    }

    #[test]
    fn moderator_can_kick() {
        assert!(can_perform(
            PlaceRole::Moderator,
            &GovernanceModel::Private,
            &PlaceAction::KickMember,
        ));
    }

    #[test]
    fn member_cannot_kick() {
        assert!(!can_perform(
            PlaceRole::Member,
            &GovernanceModel::Private,
            &PlaceAction::KickMember,
        ));
    }

    fn make_vote(voter: &str, choice: VoteChoice) -> Vote {
        Vote {
            proposal_id: "prop-1".to_string(),
            voter_id: voter.to_string(),
            choice,
            cast_at: 0,
            signature: vec![],
        }
    }
}

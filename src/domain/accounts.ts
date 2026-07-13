import { assertProtocol, fail } from "../shared/errors.js";
import type { AccountId } from "../shared/ids.js";

export type AccountRole = "admin" | "governance" | "market-maker" | "buyer" | "keeper" | "auditor";

export interface AccountProfile {
    readonly id: AccountId;
    readonly label: string;
    readonly roles: readonly AccountRole[];
    readonly blocked: boolean;
    readonly riskTier: number;
}

export interface AccountRegistration {
    readonly id: AccountId;
    readonly label: string;
    readonly roles?: readonly AccountRole[];
    readonly blocked?: boolean;
    readonly riskTier?: number;
}

function normalizeRoles(roles: readonly AccountRole[] | undefined): readonly AccountRole[] {
    const unique = new Set<AccountRole>(roles ?? ["buyer"]);
    assertProtocol(unique.size > 0, "VALIDATION_FAILED", "account must have a role");
    return Object.freeze([...unique].sort());
}

function cloneAccount(
    account: AccountProfile,
    patch: Partial<AccountProfile> = {},
): AccountProfile {
    return Object.freeze({
        id: patch.id ?? account.id,
        label: patch.label ?? account.label,
        roles: Object.freeze([...(patch.roles ?? account.roles)]),
        blocked: patch.blocked ?? account.blocked,
        riskTier: patch.riskTier ?? account.riskTier,
    });
}

export class AccountRegistry {
    private readonly accounts = new Map<AccountId, AccountProfile>();

    register(input: AccountRegistration): AccountProfile {
        if (this.accounts.has(input.id)) {
            fail("VALIDATION_FAILED", "account already exists", { id: input.id });
        }
        const riskTier = input.riskTier ?? 1;
        assertProtocol(riskTier >= 1 && riskTier <= 5, "VALIDATION_FAILED", "invalid risk tier", {
            riskTier,
        });
        const profile = Object.freeze({
            id: input.id,
            label: input.label.trim(),
            roles: normalizeRoles(input.roles),
            blocked: input.blocked ?? false,
            riskTier,
        });
        this.accounts.set(profile.id, profile);
        return profile;
    }

    get(id: AccountId): AccountProfile {
        const account = this.accounts.get(id);
        if (account === undefined) {
            fail("ACCOUNT_NOT_FOUND", "account does not exist", { id });
        }
        return account;
    }

    has(id: AccountId): boolean {
        return this.accounts.has(id);
    }

    hasRole(id: AccountId, role: AccountRole): boolean {
        return this.get(id).roles.includes(role);
    }

    requireRole(id: AccountId, role: AccountRole): AccountProfile {
        const account = this.get(id);
        assertProtocol(!account.blocked, "AUTHORIZATION_FAILED", "account is blocked", { id });
        assertProtocol(account.roles.includes(role), "AUTHORIZATION_FAILED", "missing role", {
            id,
            role,
        });
        return account;
    }

    grant(id: AccountId, role: AccountRole): AccountProfile {
        const account = this.get(id);
        const roles = normalizeRoles([...account.roles, role]);
        const next = cloneAccount(account, { roles });
        this.accounts.set(id, next);
        return next;
    }

    revoke(id: AccountId, role: AccountRole): AccountProfile {
        const account = this.get(id);
        const roles = account.roles.filter((existing) => existing !== role);
        assertProtocol(roles.length > 0, "VALIDATION_FAILED", "cannot remove final account role", {
            id,
        });
        const next = cloneAccount(account, { roles: Object.freeze(roles) });
        this.accounts.set(id, next);
        return next;
    }

    setBlocked(id: AccountId, blocked: boolean): AccountProfile {
        const account = this.get(id);
        const next = cloneAccount(account, { blocked });
        this.accounts.set(id, next);
        return next;
    }

    setRiskTier(id: AccountId, riskTier: number): AccountProfile {
        assertProtocol(riskTier >= 1 && riskTier <= 5, "VALIDATION_FAILED", "invalid risk tier", {
            riskTier,
        });
        const account = this.get(id);
        const next = cloneAccount(account, { riskTier });
        this.accounts.set(id, next);
        return next;
    }

    list(role?: AccountRole): readonly AccountProfile[] {
        const all = [...this.accounts.values()];
        return role === undefined ? all : all.filter((account) => account.roles.includes(role));
    }
}

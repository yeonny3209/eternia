/**
 * 저장소 인터페이스 + 인메모리 구현.
 *
 * 기획서 2-1은 PostgreSQL + Prisma를 쓴다(prisma/schema.prisma 참조).
 * 다만 M0 단계에서 DB 없이도 서버가 뜨고 테스트가 돌아야 하므로,
 * 라우트는 이 인터페이스에만 의존하게 하고 구현을 갈아끼울 수 있게 둔다.
 *
 * Prisma 구현으로 교체할 때 라우트는 한 줄도 고치지 않아야 한다.
 */
import type { BackgroundId, Stats } from '@eternia/shared';

export interface AccountRecord {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: number;
}

export interface CharacterRecord {
  id: string;
  accountId: string;
  nickname: string;
  nicknameKey: string;
  nicknameChangedAt: number | null;
  nicknameFreeUsed: boolean;
  background: BackgroundId;
  classId: string | null;
  hiddenClassId: string | null;
  level: number;
  exp: number;
  awakenRank: number;
  awakenPoint: number;
  stats: Stats;
  freePoints: number;
  skillPoints: number;
  mapId: string;
  gold: number;
  createdAt: number;
}

export interface Repository {
  createAccount(email: string, passwordHash: string): Promise<AccountRecord>;
  findAccountByEmail(email: string): Promise<AccountRecord | null>;
  findAccountById(id: string): Promise<AccountRecord | null>;

  /** 정규화 키로 조회 — 대소문자·혼동문자를 접은 뒤 비교한다(기획서 4-2) */
  isNicknameTaken(nicknameKey: string): Promise<boolean>;
  createCharacter(input: Omit<CharacterRecord, 'id' | 'createdAt'>): Promise<CharacterRecord>;
  listCharacters(accountId: string): Promise<CharacterRecord[]>;
  findCharacter(id: string): Promise<CharacterRecord | null>;
  updateCharacter(id: string, patch: Partial<CharacterRecord>): Promise<CharacterRecord | null>;

  /** 이전 닉네임 30일 예약 보존 */
  reserveNickname(nicknameKey: string, characterId: string, releasedAt: number): Promise<void>;
  isNicknameReserved(nicknameKey: string, forCharacterId: string, now: number): Promise<boolean>;
}

let counter = 0;
const nextId = (prefix: string): string => `${prefix}_${Date.now().toString(36)}_${(counter += 1)}`;

export class InMemoryRepository implements Repository {
  private readonly accounts = new Map<string, AccountRecord>();
  private readonly accountsByEmail = new Map<string, string>();
  private readonly characters = new Map<string, CharacterRecord>();
  private readonly nicknameKeys = new Set<string>();
  private readonly reservations = new Map<string, { characterId: string; releasedAt: number }>();

  async createAccount(email: string, passwordHash: string): Promise<AccountRecord> {
    const account: AccountRecord = {
      id: nextId('acc'),
      email: email.toLowerCase(),
      passwordHash,
      createdAt: Date.now(),
    };
    this.accounts.set(account.id, account);
    this.accountsByEmail.set(account.email, account.id);
    return account;
  }

  async findAccountByEmail(email: string): Promise<AccountRecord | null> {
    const id = this.accountsByEmail.get(email.toLowerCase());
    return id ? (this.accounts.get(id) ?? null) : null;
  }

  async findAccountById(id: string): Promise<AccountRecord | null> {
    return this.accounts.get(id) ?? null;
  }

  async isNicknameTaken(nicknameKey: string): Promise<boolean> {
    return this.nicknameKeys.has(nicknameKey);
  }

  async createCharacter(input: Omit<CharacterRecord, 'id' | 'createdAt'>): Promise<CharacterRecord> {
    const character: CharacterRecord = { ...input, id: nextId('chr'), createdAt: Date.now() };
    this.characters.set(character.id, character);
    this.nicknameKeys.add(character.nicknameKey);
    return character;
  }

  async listCharacters(accountId: string): Promise<CharacterRecord[]> {
    return [...this.characters.values()].filter((c) => c.accountId === accountId);
  }

  async findCharacter(id: string): Promise<CharacterRecord | null> {
    return this.characters.get(id) ?? null;
  }

  async updateCharacter(
    id: string,
    patch: Partial<CharacterRecord>,
  ): Promise<CharacterRecord | null> {
    const existing = this.characters.get(id);
    if (!existing) return null;
    if (patch.nicknameKey && patch.nicknameKey !== existing.nicknameKey) {
      this.nicknameKeys.delete(existing.nicknameKey);
      this.nicknameKeys.add(patch.nicknameKey);
    }
    const updated = { ...existing, ...patch };
    this.characters.set(id, updated);
    return updated;
  }

  async reserveNickname(
    nicknameKey: string,
    characterId: string,
    releasedAt: number,
  ): Promise<void> {
    this.reservations.set(nicknameKey, { characterId, releasedAt });
  }

  async isNicknameReserved(
    nicknameKey: string,
    forCharacterId: string,
    now: number,
  ): Promise<boolean> {
    const reservation = this.reservations.get(nicknameKey);
    if (!reservation) return false;
    if (now >= reservation.releasedAt) {
      this.reservations.delete(nicknameKey);
      return false;
    }
    // 자기 이전 닉은 되찾을 수 있다
    return reservation.characterId !== forCharacterId;
  }
}

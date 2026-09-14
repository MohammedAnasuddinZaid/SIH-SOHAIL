import { useCallback, useEffect, useState } from "react";
import { useAuthStore } from "../stores/authStore";
import { Button } from "../components/Button";
import { AvatarIcon, Badge, Card, EmptyState, SectionTitle } from "../components/Primitives";
import { Field } from "../components/Controls";
import { Icon } from "../components/Icons";
import { newNotificationService } from "../core/social/NotificationService";
import {
  getFriends,
  getPendingRequests,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  removeFriend,
  searchPlayers,
  type PlayerSearchHit,
} from "../core/social/FriendService";
import { getPublicFeed, reactToActivity } from "../core/social/SocialService";
import { lookupByPlayerId } from "../core/auth/AuthService";
import { toast } from "../stores/toastStore";
import type { FriendRequest, PlayerId, SocialActivity } from "../types";

export function SocialPage() {
  const playerId = useAuthStore((s) => s.player?.playerId);
  const [friends, setFriends] = useState<Array<{ id: PlayerId; username: string }>>([]);
  const [incoming, setIncoming] = useState<FriendRequest[]>([]);
  const [feed, setFeed] = useState<SocialActivity[]>([]);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PlayerSearchHit[]>([]);

  const reload = useCallback(
    async (pid: PlayerId) => {
      const [fs, reqs, pub] = await Promise.all([getFriends(pid), getPendingRequests(pid), getPublicFeed(pid, { limit: 20 })]);
      const withNames = await Promise.all(fs.map(async (f) => ({ id: f.friendId, username: (await lookupByPlayerId(f.friendId))?.username ?? f.friendId })));
      setFriends(withNames);
      setIncoming(reqs.filter((r) => r.recipientId === pid && r.status === "PENDING"));
      setFeed(pub);
    },
    [],
  );

  useEffect(() => {
    if (playerId) void reload(playerId);
  }, [playerId, reload]);

  async function doSearch(q: string) {
    setQuery(q);
    if (!playerId || q.trim().length < 2) {
      setHits([]);
      return;
    }
    setHits(await searchPlayers(q.trim(), playerId));
  }

  async function addFriend(targetId: PlayerId) {
    if (!playerId) return;
    try {
      await sendFriendRequest(playerId, targetId, newNotificationService(playerId));
      toast("ok", "Request sent", "They can accept it from their friends screen.");
      setHits([]);
      setQuery("");
    } catch (e) {
      toast("danger", "Could not send", (e as Error).message);
    }
  }

  async function accept(id: string) {
    if (!playerId) return;
    await acceptFriendRequest(playerId, id, newNotificationService(playerId));
    toast("ok", "Friend accepted");
    void reload(playerId);
  }

  async function decline(id: string) {
    if (!playerId) return;
    await declineFriendRequest(playerId, id);
    void reload(playerId);
  }

  async function unfriend(friendId: PlayerId) {
    if (!playerId) return;
    await removeFriend(playerId, friendId);
    toast("ok", "Friend removed");
    void reload(playerId);
  }

  async function react(id: string) {
    if (!playerId) return;
    await reactToActivity(playerId, id, "LIKE");
    void reload(playerId);
  }

  return (
    <>
      <SectionTitle title="Friends & feed" hint="Add by player ID or username. Everything is local to this device." />

      <Card>
        <Field label="Find a player">
          <input className="field__control" value={query} onChange={(e) => void doSearch(e.target.value)} placeholder="REP-00010001 or username" />
        </Field>
        {hits.length > 0 ? (
          <div className="stack" style={{ marginTop: "var(--sp-3)" }}>
            {hits.map((h) => (
              <div key={h.playerId} className="list-row">
                <AvatarIcon name={h.username} size="sm" />
                <div>
                  <strong>{h.username}</strong>
                  <div className="muted mono" style={{ fontSize: "var(--fs-xs)" }}>{h.playerId}</div>
                </div>
                <div style={{ flex: 1 }} />
                <Button variant="primary" size="sm" onClick={() => void addFriend(h.playerId)}>
                  Add
                </Button>
              </div>
            ))}
          </div>
        ) : query.trim().length >= 2 ? (
          <p className="muted">No matches found.</p>
        ) : null}
      </Card>

      <section className="grid-2">
        <Card>
          <SectionTitle title={`Friends (${friends.length})`} />
          {friends.length === 0 ? (
            <EmptyState title="No friends yet">
              <p>Search for a player above, or share your public ID so they can find you.</p>
            </EmptyState>
          ) : (
            <div className="stack">
              {friends.map((f) => (
                <div key={f.id} className="list-row">
                  <AvatarIcon name={f.username} size="sm" />
                  <div>
                    <strong>{f.username}</strong>
                    <div className="muted mono" style={{ fontSize: "var(--fs-xs)" }}>{f.id}</div>
                  </div>
                  <div style={{ flex: 1 }} />
                  <Button variant="ghost" size="sm" onClick={() => void unfriend(f.id)}>
                    Unfriend
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <SectionTitle title={`Requests (${incoming.length})`} />
          {incoming.length === 0 ? (
            <EmptyState title="No pending requests" />
          ) : (
            <div className="stack">
              {incoming.map((r) => (
                <div key={r.id} className="list-row">
                  <div>
                    <strong className="mono">{r.senderId}</strong>
                  </div>
                  <div style={{ flex: 1 }} />
                  <Button variant="primary" size="sm" onClick={() => void accept(r.id)}>
                    Accept
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => void decline(r.id)}>
                    Decline
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </section>

      <Card>
        <SectionTitle title="Arena feed" aside={<Badge tone="info">{feed.length} posts</Badge>} />
        {feed.length === 0 ? (
          <EmptyState title="The feed is quiet">
            <p>When you or your friends set records, they appear here.</p>
          </EmptyState>
        ) : (
          <div className="stack">
            {feed.map((a) => (
              <div key={a.id} className="list-row">
                <div style={{ flex: 1 }}>
                  <strong>{a.title}</strong>
                  <p className="muted" style={{ margin: 0, fontSize: "var(--fs-sm)" }}>{a.body}</p>
                  <div className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: 4 }}>
                    {new Date(a.createdAt).toLocaleString()} · {Object.keys(a.reactions).length} reactions
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => void react(a.id)}>
                  <Icon name="heart" size={16} /> Like
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
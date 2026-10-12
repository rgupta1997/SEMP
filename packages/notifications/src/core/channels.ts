/**
 * The realtime channel a user's notifications travel down.
 *
 * ONE definition, imported by every side, because a mismatch here is completely
 * silent: the publisher publishes successfully, nobody is subscribed to the channel
 * it named, no error is raised anywhere, and the bell simply never rings. There is
 * no log line to find and no failed request to notice. Two string literals in two
 * repositories' worth of code is exactly how that happens.
 *
 * Three consumers, and they must never disagree:
 *   - the API, minting a token that tells the browser which channel to listen on
 *   - the publisher Lambda, addressing each event
 *   - the AppSync Lambda authorizer, deciding whether a subscriber may have it
 *
 * `core/` rather than `server/` or `client/` on purpose - it is already the shared
 * subpath (`@semp/notifications/core/*`) that both halves import, and this belongs
 * to neither.
 */

/**
 * The namespace segment. Matches the AWS::AppSync::ChannelNamespace `Name` in
 * infra/semp-api.yaml; the two are deployed together and must agree.
 */
export const NOTIFICATION_CHANNEL_NAMESPACE = 'notifications';

/**
 * A user's private notification channel.
 *
 * Three segments, well inside AppSync's limit of 5 per channel and 50 characters per
 * segment (a UUID is 36). The `user` segment is not decoration: it keeps room for
 * sibling channels under the same namespace without any of them being a prefix of a
 * user's, which matters because prefix confusion is the shape of the wildcard
 * subscribe attack the authorizer exists to block.
 */
export function notificationChannelPath(userId: string): string {
  return `/${NOTIFICATION_CHANNEL_NAMESPACE}/user/${userId}`;
}

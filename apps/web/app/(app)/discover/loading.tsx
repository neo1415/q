import { FeedSkeleton } from "@/features/discover/stage/feed-skeleton";

/**
 * Discover while the server reads the first page: the feed's own shape
 * (Discover v2), not the app-wide loader, so the first poster lands in a
 * frame that is already there.
 */
export default function Loading() {
  return <FeedSkeleton />;
}

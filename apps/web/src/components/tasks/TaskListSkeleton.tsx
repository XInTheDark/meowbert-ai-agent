import { Skeleton, SkeletonRegion } from "../Skeleton";

/**
 * Placeholder rows shaped like the task list, so the layout does not shift when
 * real rows arrive.
 */
export function TaskListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <SkeletonRegion label="Loading tasks" className="task-list-skeleton">
      {Array.from({ length: rows }, (_, index) => (
        <div className="task-list-skeleton-row" key={index}>
          <Skeleton width="1rem" height="1rem" />
          <div className="task-list-skeleton-main">
            {/* Vary the title width so the block does not read as a table. */}
            <Skeleton width={`${58 + ((index * 13) % 34)}%`} height="0.85rem" />
            <Skeleton width={`${26 + ((index * 7) % 18)}%`} height="0.7rem" />
          </div>
          <Skeleton width="4.5rem" height="1.1rem" className="task-list-skeleton-status" />
          <Skeleton width="3.5rem" height="0.7rem" />
        </div>
      ))}
    </SkeletonRegion>
  );
}

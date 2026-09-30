import { useEffect, useMemo, useRef } from "react";
import type { TaskMessage } from "../../lib/types";
import {
  buildStableHistoricalToolGroupDescriptors,
  type StableToolGroupDescriptor
} from "./shared";

export function useStableHistoricalToolGroupDescriptors(messages: TaskMessage[]): Map<number, StableToolGroupDescriptor> {
  const historicalToolGroupDescriptorsRef = useRef<StableToolGroupDescriptor[]>([]);
  const historicalToolGroupCounterRef = useRef(0);
  const descriptorState = useMemo(
    () =>
      buildStableHistoricalToolGroupDescriptors(
        messages,
        historicalToolGroupDescriptorsRef.current,
        historicalToolGroupCounterRef.current
      ),
    [messages]
  );

  useEffect(() => {
    historicalToolGroupDescriptorsRef.current = descriptorState.descriptors;
    historicalToolGroupCounterRef.current = descriptorState.nextCounter;
  }, [descriptorState.descriptors, descriptorState.nextCounter]);

  return useMemo(
    () => new Map(descriptorState.descriptors.map((descriptor) => [descriptor.startIndex, descriptor])),
    [descriptorState.descriptors]
  );
}

import { expect, it, vi } from "vitest";
import { RefreshQueue } from "./refresh-queue";
it("coalesces queued events and upgrades them to a manual check",async()=>{
  const refresh=vi.fn().mockResolvedValue(undefined);const queue=new RefreshQueue(refresh);
  await Promise.all([queue.request(),queue.request(),queue.request(true)]);
  expect(refresh).toHaveBeenCalledExactlyOnceWith(true);
});
it("does not lose an event arriving as the previous check resolves",async()=>{
  let finish:()=>void=()=>{};const hold=new Promise<void>(resolve=>{finish=resolve;});
  const refresh=vi.fn().mockReturnValueOnce(hold).mockResolvedValue(undefined);const queue=new RefreshQueue(refresh);
  const first=queue.request();await Promise.resolve();
  const late=hold.then(()=>queue.request(true));finish();await first;await late;
  expect(refresh.mock.calls).toEqual([[false],[true]]);
});

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
const remove=vi.hoisted(()=>vi.fn());
vi.mock("./manager",()=>({createDesktopDocker:()=>({getImage:(reference:string)=>({inspect:async()=>({Id:reference}),remove:()=>remove(reference)})})}));
import { maintainDownloadedSandboxes } from "./cleanup";
it("keeps active images and their extracted skills, and removes only unused downloaded images", async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"sandbox-cleanup-"));
  try {
    const images=[{reference:"active",resourceDirectory:"sha256_aaa"},{reference:"unused",resourceDirectory:"sha256_bbb"}];
    for(const image of images) await fs.mkdir(path.join(root,image.resourceDirectory));
    await fs.writeFile(path.join(root,"downloaded-images.json"),JSON.stringify(images));
    await maintainDownloadedSandboxes({resourcesRoot:root,currentImage:"new",skillsRoot:path.join(root,"sha256_ccc","skills"),downloaded:true,inUseImages:["active"]});
    expect(remove).toHaveBeenCalledExactlyOnceWith("unused");
    expect(await fs.stat(path.join(root,"sha256_aaa"))).toBeTruthy();
    expect(JSON.parse(await fs.readFile(path.join(root,"downloaded-images.json"),"utf8"))).toEqual([images[0],{reference:"new",resourceDirectory:"sha256_ccc"}]);
  } finally {await fs.rm(root,{recursive:true,force:true});}
});

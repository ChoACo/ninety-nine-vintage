import { readFile } from "node:fs/promises";

async function run() {
  const content = await readFile("src/app/api/admin/operator/orders/route.ts", "utf8");
  const regex = /expectedActivityKey[\s\S]{0,1200}activityKey\s*!==\s*expectedActivityKey/;
  const match = content.match(regex);
  console.log("Matched:", !!match);
  if (!match) {
    // Let's see if we can locate expectedActivityKey and activityKey
    const firstIdx = content.indexOf("expectedActivityKey");
    const lastIdx = content.lastIndexOf("activityKey");
    console.log("expectedActivityKey index:", firstIdx);
    console.log("activityKey index:", lastIdx);
    if (firstIdx !== -1 && lastIdx !== -1) {
      console.log("Distance:", lastIdx - firstIdx);
      console.log("Substring:");
      console.log(content.slice(firstIdx, lastIdx + 50));
    }
  }
}

run();

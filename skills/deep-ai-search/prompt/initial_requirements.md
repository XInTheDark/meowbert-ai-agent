AI-powered search MCP server.

instead of "brave search" focusing only on querying the api, or "fetch" focusing on just fetching, it puts AI as a core part, aka, a lot of the filtering/extraction features will involve LLM processing.

terminology:

\- big LLM, powerful LLM with more knowledge

\- small LLM, a very fast LLM for more batched tasks.

these LLM configs will be specified in the MCP's config file.



 it offers mainly two functions:

\- SEARCH. this is basically optimized for breadth.

1) instead of just specifying "number of results", the ai specifies a "breadth" parameter, which is on a log-scale.

How it roughly works:

​	- first, we convert this breadth into some internal parameters: (number of considered websites, number of returned websites, distribution of domains — a greater breadth will call for a "flatter distribution", aka more balanced).

​	- we estimate the number of queries we need to make to the brave search API.

​	- we ask the big LLM to generate some similar but slightly varying versions of the search query, and pass all of those to the brave API. the prompt is important here, because 1) they cannot be too identical (it would be pointless), but cannot be so wildly different. 2) it needs to meet a format that is optimized for brave search. (including character limits).

​	 - a note on the brave API: at this step we should do the brave API calls in parallel (with reasonable batching limits - this can be a config param) to save time.

​	 - a note on ranking: usually, the first results are the most relevant in the brave responses, so when we combine different results, we should do it in interpolating order: 1st result from first query, 1st from second query, ... also, we need to deduplicate by URL.

​	- we now have a list of results and snippets. then, we ask the small LLM to filter away clearly irrelevant pages, and keep the relevant ones. (for token efficiency, we ask it to return only a list of numerical indexes like 1,2,3,...)

​	 - a note: if there are a shit ton of pages, we should also need to batch results given to the small LLM, and combine later. this can be a configurable param.

​	- then, we use the (number of returned websites, distribution) parameters to decide the final results to return.

2) other parameters the AI can specify: domain allowlist, blocklist; date; basically stuff that brave search supports.

3) we need to put this in tool description so AI can understand: when breadth is higher, the search query passed to this tool should not be so simple, but instead it should be more detailed so that the AI can better make a range of queries.

   

\- FETCH. this is optimized for depth. we need very powerful "fetch" abilities, so given a URL, we must parse it with SOTA methods.

 \- just some things of what it should do:

  \- process website structure very well (use a sota and efficient library)

  \- not get blocked by common "robot filters"

  \- if it is blocked, also try to use `puppeteer-extra-plugin-stealth` automatically to fetch.

  \- process files

  \- for files, maybe also have caching for some time, so that repeated queries don't need re-fetch

  \- images (return as image directly) 

Parameters.

  \- similar to above, the ai gives a "depth" param. this is then translated into internally: max content length in chars.

  \- pure AI mode (default false)

  {"ai_mode": true, "prompt": "e.g. Summarize this page... or, Extract the data... or, ..."}

   \- in this mode, it’s basically an extra step after the smart mode below. after we get the final contents, just pass entire contents to the big LLM and prompt it, and return an AI result.

  \- smart mode (default enabled)

{"smart_mode": true (default), "prompt": "Only parts relevant to ..., or, All info..."}

   \- in this mode, we aim to return the original text, BUT, we want to return the "best" maxContentLength chars.

   \- to do this, we:

​    \- truncate the original text if it is super big (aka, to the small model's context window, configurable in config)

​     \- a note: if the original text is WAY smaller than maxContentLength, like maybe <50%, then we skip the remaining AI stuff entirely and just return. otherwise, proceed.

​    \- chunk the original text into N chunks (to find good params here; for bigger maxContentLength, maybe bigger chunks is also appropriate). have some small % of chunk overlap.

​    \- prompt the AI to return the best K chunks, where K is just roughly maxContentLength / chunk size. The "prompt" param above should be passed to the AI, so it can know what is the meaning of best chunks. (analogy - If I link a 50-page PDF about "Climate Change," and I want to know about "Sea Levels," the "best" chunks are different than if I want to know about "Carbon Tax.")

​     \- here the chunks will be input as a JSON format like {index: ..., text: ...}

​    \- the AI returns a schema like this: [1, 2, 3, {start: 6, end: 10}], aka each element is either one chunk or is a range.

​    \- then, we post-process & validate (important as the AI may over-count, or hallucinate indexes), and then return the final processed text.



TECHNICAL DETAILS.

for fetch:

\- if the type is html (website), we use `**@mozilla/readability**` to first clean.

 \- then: **Convert:** Turndown (or similar) converts that clean HTML into Markdown.

\- if the type is a file, use **markitdown.**



CONFIG.

AI stuff:

\- provider and model and etc, for both big and small models

 \- (maybe we want to just use the AI SDK? so have that compatible config)

\- default params for tools (eg. max content length and default mode and whatnot)

\- other settings, eg. whether to use playwright on fail; etc

apis:

\- brave api keys (a list so we can have multiple to iterate on)

—-

note that this is basically closer to perplexity’s implementation (but we still use existing brave API). 

advantages over a built-in search like openai: more transparent and customizable (wrt latency and cost); model agnostic; easier for models to use, so performance boost for cheaper models (maybe). 
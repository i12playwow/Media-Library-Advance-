{
    "model": "qwen3.5-plus",
    "temperature": 1,
    "messages": [
        {
            "role": "system",
            "content": "You are an AI agent designed to operate in an iterative loop to automate browser tasks. Your ultimate goal is accomplishing the task provided in <user_request>.\n\n<intro>\nYou excel at following tasks:\n1. Navigating complex websites and extracting precise information\n2. Automating form submissions and interactive web actions\n3. Gathering and saving information \n4. Operate effectively in an agent loop\n5. Efficiently performing diverse web tasks\n</intro>\n\n<language_settings>\n- Default working language: **English**\n- Use the language that user is using. Return in user's language.\n</language_settings>\n\n<input>\nAt every step, your input will consist of: \n1. <agent_history>: A chronological event stream including your previous actions and their results.\n2. <agent_state>: Current <user_request> and <step_info>.\n3. <browser_state>: Tabs, Current Tab, Current URL, interactive elements indexed for actions, and visible page content.\n</input>\n\n<agent_history>\nAgent history will be given as a list of step information as follows:\n\n<step_{step_number}>:\nEvaluation of Previous Step: Assessment of last action\nMemory: Your memory of this step\nNext Goal: Your goal for this step\nAction Results: Your actions and their results\n</step_{step_number}>\n\nand system messages wrapped in <sys> tag.\n</agent_history>\n\n<user_request>\nUSER REQUEST: This is your ultimate objective and always remains visible.\n- This has the highest priority. Make the user happy.\n- If the user request is very specific - then carefully follow each step and dont skip or hallucinate steps.\n- If the task is open ended you can plan yourself how to get it done.\n</user_request>\n\n<browser_state>\n1. Browser State will be given as:\n\nOpen Tabs: Open tabs with their ids.\nCurrent Tab: The tab you are currently viewing.\nCurrent URL: URL of the page you are currently viewing.\nInteractive Elements: All interactive elements will be provided in format as [index]<type>text</type> where\n- index: Numeric identifier for interaction\n- type: HTML element type (button, input, etc.)\n- text: Element description\n\nExamples:\n[33]<div>User form</div>\n\\t*[35]<button aria-label='Submit form'>Submit</button>\n\nNote that:\n- Only elements with numeric indexes in [] are interactive\n- (stacked) indentation (with \\t) is important and means that the element is a (html) child of the element above (with a lower index)\n- Elements tagged with `*[` are the new clickable elements that appeared on the website since the last step - if url has not changed.\n- Pure text elements without [] are not interactive.\n</browser_state>\n\n<browser_rules>\nStrictly follow these rules while using the browser and navigating the web:\n- Only interact with elements that have a numeric [index] assigned.\n- Only use indexes that are explicitly provided.\n- If the page changes after, for example, an input text action, analyze if you need to interact with new elements, e.g. selecting the right option from the list.\n- By default, only elements in the visible viewport are listed. Use scrolling actions if you suspect relevant content is offscreen which you need to interact with. Scroll ONLY if there are more pixels below or above the page.\n- You can scroll by a specific number of pages using the num_pages parameter (e.g., 0.5 for half page, 2.0 for two pages).\n- All the elements that are scrollable are marked with `data-scrollable` attribute. Including the scrollable distance in every directions. You can scroll *the element* in case some area are overflowed.\n- If a captcha appears, tell user you can not solve captcha. Finish the task and ask user to solve it.\n- If expected elements are missing, try scrolling, or navigating back.\n- If the page is not fully loaded, use the `wait` action.\n- Do not repeat one action for more than 3 times unless some conditions changed.\n- If you fill an input field and your action sequence is interrupted, most often something changed e.g. suggestions popped up under the field.\n- If the <user_request> includes specific page information such as product type, rating, price, location, etc., try to apply filters to be more efficient.\n- The <user_request> is the ultimate goal. If the user specifies explicit steps, they have always the highest priority.\n- If you input_text into a field, you might need to press enter, click the search button, or select from dropdown for completion.\n- Don't login into a page if you don't have to. Don't login if you don't have the credentials. \n- There are 2 types of tasks always first think which type of request you are dealing with:\n1. Very specific step by step instructions:\n- Follow them as very precise and don't skip steps. Try to complete everything as requested.\n2. Open ended tasks. Plan yourself, be creative in achieving them.\n- If you get stuck e.g. with logins or captcha in open-ended tasks you can re-evaluate the task and try alternative ways, e.g. sometimes accidentally login pops up, even though there some part of the page is accessible or you get some information via web search.\n</browser_rules>\n\n<task_completion_rules>\nYou must call the `done` action in one of three cases:\n- When you have fully completed the USER REQUEST.\n- When you reach the final allowed step (`max_steps`), even if the task is incomplete.\n- When you feel stuck or unable to solve user request. Or user request is not clear or contains inappropriate content.\n- When it is ABSOLUTELY IMPOSSIBLE to continue.\n\nThe `done` action is your opportunity to terminate and share your findings with the user.\n- Set `success` to `true` only if the full USER REQUEST has been completed with no missing components.\n- If any part of the request is missing, incomplete, or uncertain, set `success` to `false`.\n- You can use the `text` field of the `done` action to communicate your findings and to provide a coherent reply to the user and fulfill the USER REQUEST.\n- You are ONLY ALLOWED to call `done` as a single action. Don't call it together with other actions.\n- If the user asks for specified format, such as \"return JSON with following structure\", \"return a list of format...\", MAKE sure to use the right format in your answer.\n- If the user asks for a structured output, your `done` action's schema may be modified. Take this schema into account when solving the task!\n</task_completion_rules>\n\n<reasoning_rules>\nExhibit the following reasoning patterns to successfully achieve the <user_request>:\n\n- Reason about <agent_history> to track progress and context toward <user_request>.\n- Analyze the most recent \"Next Goal\" and \"Action Result\" in <agent_history> and clearly state what you previously tried to achieve.\n- Analyze all relevant items in <agent_history> and <browser_state> to understand your state.\n- Explicitly judge success/failure/uncertainty of the last action. Never assume an action succeeded just because it appears to be executed in your last step in <agent_history>. If the expected change is missing, mark the last action as failed (or uncertain) and plan a recovery.\n- Analyze whether you are stuck, e.g. when you repeat the same actions multiple times without any progress. Then consider alternative approaches e.g. scrolling for more context or ask user for help.\n- Ask user for help if you have any difficulty. Keep user in the loop.\n- If you see information relevant to <user_request>, plan saving the information to memory.\n- Always reason about the <user_request>. Make sure to carefully analyze the specific steps and information required. E.g. specific filters, specific form fields, specific information to search. Make sure to always compare the current trajectory with the user request and think carefully if thats how the user requested it.\n</reasoning_rules>\n\n<examples>\nHere are examples of good output patterns. Use them as reference but never copy them directly.\n\n<evaluation_examples>\n\"evaluation_previous_goal\": \"Successfully navigated to the product page and found the target information. Verdict: Success\"\n\"evaluation_previous_goal\": \"Clicked the login button and user authentication form appeared. Verdict: Success\"\n</evaluation_examples>\n\n<memory_examples>\n\"memory\": \"Found many pending reports that need to be analyzed in the main page. Successfully processed the first 2 reports on quarterly sales data and moving on to inventory analysis and customer feedback reports.\"\n</memory_examples>\n\n<next_goal_examples>\n\"next_goal\": \"Click on the 'Add to Cart' button to proceed with the purchase flow.\"\n</next_goal_examples>\n</examples>\n\n<output>\n{\n  \"evaluation_previous_goal\": \"Concise one-sentence analysis of your last action. Clearly state success, failure, or uncertain.\",\n  \"memory\": \"1-3 concise sentences of specific memory of this step and overall progress. You should put here everything that will help you track progress in future steps. Like counting pages visited, items found, etc.\",\n  \"next_goal\": \"State the next immediate goal and action to achieve it, in one clear sentence.\",\n  \"action\":{\n    \"Action name\": {// Action parameters}\n  }\n}\n</output>\n"
        },
        {
            "role": "user",
            "content": "<agent_state>\n<user_request>\n<agent_state>\n<user_request>\nhow to use this\n</user_request>\n<step_info>\nStep 2 of 40 max possible steps\nCurrent time: 4/19/2026, 12:49:30 AM\n</step_info>\n</agent_state>\n\n<agent_history>\n<sys>Page navigated to → https://github.com/marketplace/actions/typescript-compiler</sys>\n<step_1>\nEvaluation of Previous Step: Successfully navigated to the TypeScript Compiler GitHub Actions marketplace page. The page shows usage instructions and documentation for the action. Verdict: Success\nMemory: Found the TypeScript Compiler GitHub Action page. The page displays usage instructions with a YAML workflow example showing how to integrate this action into GitHub workflows. The action compiles TypeScript code and checks for errors.\nNext Goal: Scroll down to see more details about how to use this TypeScript compiler action, including any additional documentation or examples.\nAction Results: ✅ Scrolled page by 468px.\n</step_1>\n</agent_history>\n\n<browser_state>\n| Tab ID | URL | Title | Current |\n|-----|-----|-----|-----|\n| 1329972654 | https://github.com/marketplace/actions/typescript-compiler | Typescript compiler · Actions · GitHub Marketplace | ✅ |\n\nCurrent Page: [Typescript compiler · Actions · GitHub Marketplace](https://github.com/marketplace/actions/typescript-compiler)\nPage info: 1902x935px viewport, 1887x1640px total page size, 0.5 pages above, 0.2 pages below, 1.8 total pages, at 67% of page\n\nInteractive elements from top layer of the current page inside the viewport:\n\n... 473 pixels above (0.5 pages) - scroll to see more ...\non\n:\npush\n:\npull_request\n:\njobs\n:\ntsc\n:\nname\n:\ntsc\nruns-on\n:\nubuntu-latest\nsteps\n:\n    -\nuses\n:\nactions/checkout@v1\n-\nname\n:\ninstall node v12\nuses\n:\nactions/setup-node@v1\nwith\n:\nnode-version\n:\n12\n-\nname\n:\nyarn install\nrun\n:\nyarn install\n-\nname\n:\ntsc\nuses\n:\nicrawl/action-tsc@v1\n[0]<clipboard-copy role=button value=on:\n  push:\n  pull_r... aria-label=Copy />\nPassing command-line parameters to\ntsc\n[1]<a aria-label=Permalink: Passing c... id=user-content-passing... />\nYou can pass the\n--project\nparameter to\ntsc\nif your\ntsconfig.json\nis not in the root of your project:\n-\nname\n:\ntsc compile\nuses\n:\niCrawl/action-tsc@v1\nwith\n:\nproject\n:\nsubdirectorywith_tsconfig\n[2]<clipboard-copy role=button value=- name: tsc compile\n... aria-label=Copy />\nContributing\n[3]<a aria-label=Permalink: Contribut... id=user-content-contrib... />\nFork it!\nCreate your feature branch:\ngit checkout -b my-new-feature\nCommit your changes:\ngit commit -am 'Add some feature'\nPush to the branch:\ngit push origin my-new-feature\nSubmit a pull request :D\nAuthor\n[4]<a aria-label=Permalink: Author id=user-content-author />\naction-tsc\n©\n[5]<a >iCrawl />\nAuthored and maintained by iCrawl.\n[6]<a  />\n\t[7]<img alt=@dependabot-preview />\n[8]<a  />\n\t[9]<img alt=@iCrawl />\n[10]<a  />\n\t[11]<img alt=@renovate />\n[12]<a  />\n\t[13]<img alt=@favna />\n[14]<a  />\n\t[15]<img alt=@renovate-bot />\n[16]<a  />\n\t[17]<img alt=@piotrb />\n[18]<a  />\n\t[19]<img alt=@KeithHenry />\nResources\n[20]<a id=_R_2mmr9b_ />\n\t[21]<span >Open an issue\n(\n0\n) />\n[22]<a id=_R_3mmr9b_ />\n\t[23]<span >Pull requests\n(\n0\n) />\n[24]<a id=_R_4mmr9b_ />\n\t[25]<span >View source code />\n[26]<a id=_R_6mmr9b_ />\n\t[27]<span >Report abuse />\nTypescript compiler\nis not certified by GitHub. It is provided by a third-party and is governed by separate terms of service, privacy policy, and support documentation.\n... 232 pixels below (0.2 pages) - scroll to see more ...\n\n</browser_state>\n</user_request>\n<step_info>\nStep 1 of 40 max possible steps\nCurrent time: 4/19/2026, 12:52:49 AM\n</step_info>\n</agent_state>\n\n<agent_history>\n<sys>Page navigated to → https://github.com/copilot/c/3bf0a66e-595b-450e-adf5-1557ccca38b5</sys>\n</agent_history>\n\n<browser_state>\n| Tab ID | URL | Title | Current |\n|-----|-----|-----|-----|\n| 1329972654 | https://github.com/copilot/c/3bf0a66e-595b-450e-adf5-1557ccca38b5 | TypeScript compile check GitHub workflow · GitHub Copilot | ✅ |\n\nCurrent Page: [TypeScript compile check GitHub workflow · GitHub Copilot](https://github.com/copilot/c/3bf0a66e-595b-450e-adf5-1557ccca38b5)\nPage info: 1902x935px viewport, 1902x935px total page size, 0.0 pages above, 0.0 pages below, 1.0 total pages, at 0% of page\n\nInteractive elements from top layer of the current page inside the viewport:\n\n[Start of page]\n*[0]<a aria-label=GitHub homepage target=_self />\n*[1]<a aria-label=New chat />\n\t*[2]<div  />\n\t\t*[3]<div >New chat />\n*[4]<a aria-label=Agents />\n\t*[5]<div  />\n\t\t*[6]<div >Agents />\n*[7]<a aria-label=Spaces />\n\t*[8]<div  />\n\t\t*[9]<div >Spaces />\n*[10]<a aria-label=Spark />\n\t*[11]<div  />\n\t\t*[12]<div >Spark />\n\t\t*[13]<div  />\n\t\t\t*[14]<div  />\n\t\t\t\t*[15]<span >Preview />\nAgent sessions\n*[16]<button type=button />\n*[17]<a  />\n\t*[18]<div  />\n\t\t*[19]<div >Exploring codebase and developing implementation plan />\n\t\t*[20]<p >Completed\n·\nMar 30, 2026 />\n*[21]<a  />\n\t*[22]<div  />\n\t\t*[23]<div >Working on unlocking user feature access />\n\t\t*[24]<p >Completed\n·\nMar 30, 2026 />\n*[25]<a  />\n\t*[26]<div  />\n\t\t*[27]<div >Updating devcontainer configuration for development environment />\n\t\t*[28]<p >Merged\n· #6\n·\nMar 1, 2026 />\nChats\n*[29]<button type=button />\n*[30]<a  />\n\t*[31]<div  />\n\t\t*[32]<div >TypeScript compile check GitHub workflow />\n*[33]<button type=button aria-expanded=false id=_r_5f_ aria-haspopup=true />\n*[34]<a  />\n\t*[35]<div  />\n\t\t*[36]<div >Improving your LICENSE-CODE file />\n*[37]<a  />\n\t*[38]<div  />\n\t\t*[39]<div >Understanding and modifying an Electron app />\n*[40]<button aria-label=Collapse sidebar>Collapse />\n*[41]<button aria-expanded=false id=_r_k_ aria-haspopup=true />\n\t*[42]<div  />\n\t\t*[43]<img  />\n\t*[44]<div >theowu1997\nCopilot Pro />\n*[45]<button >Condense sidebar />\n*[46]<button aria-expanded=false id=_r_57_ aria-haspopup=true>TypeScript compile check GitHub workflow />\n*[47]<button type=button />\n\t*[48]<span >Share />\n*[49]<button type=button />\n*[50]<div data-scrollable=\"top=1269, \" >Copilot Chat\nTypeScript compile check GitHub workflow\nYou said: Add this to your `.github/workflows/` YAML file:\nAdd this to your `.github/workflows/` YAML file: ```yaml on: push: pull_request: jobs: tsc: name: tsc runs-on: ubuntu-latest steps: - uses: actions/checkout@v1 - name: install node v12 uses: actions/setup-node@v1 with: node-version: 12 - name: yarn install run: yarn install - name: tsc uses: icrawl/action-tsc@v1 ``` **For tsconfig.json in If your tsconfig.json is not in the root, use the `project` parameter: ```yaml - name: tsc compile uses: iCrawl/action-tsc@v1 with: project: subdirectorywith_tsconfig ``` **Key - The action compiles TypeScript code and checks for errors - Runs on ubuntu-latest - Requires Node.js setup and dependency installation first - Repository: - Maintained by iCrawl\nCopilot said: To implement your request, add the following\nTo implement your request, add the following YAML workflow file under the\n.github/workflows/\ndirectory in your repository. Here’s a ready-to-use example:\nIf your\ntsconfig.json\nis in the root of the repository, use:\nYAML\nname:\nTypeScript\nCompile\nCheck\non:\npush:\npull_request:\njobs:\ntsc:\nname:\ntsc\nruns-on:\nubuntu-latest\nsteps:\n-\nuses:\nactions/checkout@v1\n-\nname:\ninstall\nnode\nv12\nuses:\nactions/setup-node@v1\nwith:\nnode-version:\n12\n-\nname:\nyarn\ninstall\nrun:\nyarn\ninstall\n-\nname:\ntsc\nuses:\nicrawl/action-tsc@v1\nIf your\ntsconfig.json\nis\nnot\nat the root, set the path in the\nproject:\nparameter. For example, if your config is at\nsubdir/tsconfig.json\n:\nYAML\nname:\nTypeScript\nCompile\nCheck\non:\npush:\npull_request:\njobs:\ntsc:\nname:\ntsc\nruns-on:\nubuntu-latest\nsteps:\n-\nuses:\nactions/checkout@v1\n-\nname:\ninstall\nnode\nv12\nuses:\nactions/setup-node@v1\nwith:\nnode-version:\n12\n-\nname:\nyarn\ninstall\nrun:\nyarn\ninstall\n-\nname:\ntsc\ncompile\nuses:\nicrawl/action-tsc@v1\nwith:\nproject:\nsubdir\nTips\nReplace\nsubdir\nwith your actual directory containing\ntsconfig.json\n.\nThe action will compile your TypeScript and fail if there are any errors.\nThis config uses Node 12 because some legacy projects require it, but consider updating to Node 16 or newer if possible.\nSave this file as something like\n.github/workflows/tsc.yml\nin your repository. />\n\t*[51]<button type=button />\n\t*[52]<button type=button />\n\t*[53]<button type=button />\n\t*[54]<button type=button />\n\t*[55]<button type=button />\n\t*[56]<button type=button aria-expanded=false id=_r_6n_ aria-haspopup=true />\nOn April 24 we'll start using GitHub Copilot interaction data for AI model training unless you opt out.\n*[57]<a >Review this update />\nand manage your preferences in your\n*[58]<a >GitHub account settings />\n.\n*[59]<button type=button />\nYou have used all premium requests available this month. Upgrade your plan to increase your limit. Limit resets on May 1, 2026.\n*[60]<a  />\n\t*[61]<span >Upgrade />\n*[62]<button type=button />\n*[63]<textarea placeholder=Ask anything or type... id=copilot-chat-textare... />\n*[64]<button type=button aria-expanded=false id=_r_4g_ aria-haspopup=true />\n*[65]<button type=button aria-expanded=false id=_r_4o_ aria-haspopup=true />\n*[66]<button type=button />\n*[67]<button type=button aria-expanded=false id=_r_4u_ aria-haspopup=true />\n\t*[68]<span  />\n\t\t*[69]<span >Model:\nGPT-4.1 />\n*[70]<button type=button />\n[End of page]\n\n</browser_state>\n\n"
        }
    ],
    "tools": [
        {
            "type": "function",
            "function": {
                "name": "AgentOutput",
                "description": "You MUST call this tool every step!",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "evaluation_previous_goal": {
                            "type": "string"
                        },
                        "memory": {
                            "type": "string"
                        },
                        "next_goal": {
                            "type": "string"
                        },
                        "action": {
                            "anyOf": [
                                {
                                    "type": "object",
                                    "properties": {
                                        "done": {
                                            "type": "object",
                                            "properties": {
                                                "text": {
                                                    "type": "string"
                                                },
                                                "success": {
                                                    "default": true,
                                                    "type": "boolean"
                                                }
                                            },
                                            "required": [
                                                "text",
                                                "success"
                                            ],
                                            "additionalProperties": false
                                        }
                                    },
                                    "required": [
                                        "done"
                                    ],
                                    "additionalProperties": false,
                                    "description": "Complete task. Text is your final response to the user — keep it concise unless the user explicitly asks for detail."
                                },
                                {
                                    "type": "object",
                                    "properties": {
                                        "wait": {
                                            "type": "object",
                                            "properties": {
                                                "seconds": {
                                                    "default": 1,
                                                    "type": "number",
                                                    "minimum": 1,
                                                    "maximum": 10
                                                }
                                            },
                                            "required": [
                                                "seconds"
                                            ],
                                            "additionalProperties": false
                                        }
                                    },
                                    "required": [
                                        "wait"
                                    ],
                                    "additionalProperties": false,
                                    "description": "Wait for x seconds. Can be used to wait until the page or data is fully loaded."
                                },
                                {
                                    "type": "object",
                                    "properties": {
                                        "click_element_by_index": {
                                            "type": "object",
                                            "properties": {
                                                "index": {
                                                    "type": "integer",
                                                    "minimum": 0,
                                                    "maximum": 9007199254740991
                                                }
                                            },
                                            "required": [
                                                "index"
                                            ],
                                            "additionalProperties": false
                                        }
                                    },
                                    "required": [
                                        "click_element_by_index"
                                    ],
                                    "additionalProperties": false,
                                    "description": "Click element by index"
                                },
                                {
                                    "type": "object",
                                    "properties": {
                                        "input_text": {
                                            "type": "object",
                                            "properties": {
                                                "index": {
                                                    "type": "integer",
                                                    "minimum": 0,
                                                    "maximum": 9007199254740991
                                                },
                                                "text": {
                                                    "type": "string"
                                                }
                                            },
                                            "required": [
                                                "index",
                                                "text"
                                            ],
                                            "additionalProperties": false
                                        }
                                    },
                                    "required": [
                                        "input_text"
                                    ],
                                    "additionalProperties": false,
                                    "description": "Click and type text into an interactive input element"
                                },
                                {
                                    "type": "object",
                                    "properties": {
                                        "select_dropdown_option": {
                                            "type": "object",
                                            "properties": {
                                                "index": {
                                                    "type": "integer",
                                                    "minimum": 0,
                                                    "maximum": 9007199254740991
                                                },
                                                "text": {
                                                    "type": "string"
                                                }
                                            },
                                            "required": [
                                                "index",
                                                "text"
                                            ],
                                            "additionalProperties": false
                                        }
                                    },
                                    "required": [
                                        "select_dropdown_option"
                                    ],
                                    "additionalProperties": false,
                                    "description": "Select dropdown option for interactive element index by the text of the option you want to select"
                                },
                                {
                                    "type": "object",
                                    "properties": {
                                        "scroll": {
                                            "type": "object",
                                            "properties": {
                                                "down": {
                                                    "default": true,
                                                    "type": "boolean"
                                                },
                                                "num_pages": {
                                                    "default": 0.1,
                                                    "type": "number",
                                                    "minimum": 0,
                                                    "maximum": 10
                                                },
                                                "pixels": {
                                                    "type": "integer",
                                                    "minimum": 0,
                                                    "maximum": 9007199254740991
                                                },
                                                "index": {
                                                    "type": "integer",
                                                    "minimum": 0,
                                                    "maximum": 9007199254740991
                                                }
                                            },
                                            "required": [
                                                "down",
                                                "num_pages"
                                            ],
                                            "additionalProperties": false
                                        }
                                    },
                                    "required": [
                                        "scroll"
                                    ],
                                    "additionalProperties": false,
                                    "description": "Scroll vertically. Without index: scrolls the document. With index: scrolls the container at that index (or its nearest scrollable ancestor). Use index of a data-scrollable element to scroll a specific area."
                                },
                                {
                                    "type": "object",
                                    "properties": {
                                        "scroll_horizontally": {
                                            "type": "object",
                                            "properties": {
                                                "right": {
                                                    "default": true,
                                                    "type": "boolean"
                                                },
                                                "pixels": {
                                                    "type": "integer",
                                                    "minimum": 0,
                                                    "maximum": 9007199254740991
                                                },
                                                "index": {
                                                    "type": "integer",
                                                    "minimum": 0,
                                                    "maximum": 9007199254740991
                                                }
                                            },
                                            "required": [
                                                "right",
                                                "pixels"
                                            ],
                                            "additionalProperties": false
                                        }
                                    },
                                    "required": [
                                        "scroll_horizontally"
                                    ],
                                    "additionalProperties": false,
                                    "description": "Scroll horizontally. Without index: scrolls the document. With index: scrolls the container at that index (or its nearest scrollable ancestor). Use index of a data-scrollable element to scroll a specific area."
                                },
                                {
                                    "type": "object",
                                    "properties": {
                                        "open_new_tab": {
                                            "type": "object",
                                            "properties": {
                                                "url": {
                                                    "type": "string",
                                                    "description": "The URL to open in the new tab"
                                                }
                                            },
                                            "required": [
                                                "url"
                                            ],
                                            "additionalProperties": false
                                        }
                                    },
                                    "required": [
                                        "open_new_tab"
                                    ],
                                    "additionalProperties": false,
                                    "description": "Open a new browser tab with the specified URL. The new tab becomes the current tab for all subsequent page operations."
                                },
                                {
                                    "type": "object",
                                    "properties": {
                                        "switch_to_tab": {
                                            "type": "object",
                                            "properties": {
                                                "tab_id": {
                                                    "type": "integer",
                                                    "minimum": -9007199254740991,
                                                    "maximum": 9007199254740991,
                                                    "description": "The tab ID to switch to"
                                                }
                                            },
                                            "required": [
                                                "tab_id"
                                            ],
                                            "additionalProperties": false
                                        }
                                    },
                                    "required": [
                                        "switch_to_tab"
                                    ],
                                    "additionalProperties": false,
                                    "description": "Switch to an existing tab by its ID. After switching, all page operations will target the new current tab. You can only switch to tabs in the tab list shown in browser state."
                                },
                                {
                                    "type": "object",
                                    "properties": {
                                        "close_tab": {
                                            "type": "object",
                                            "properties": {
                                                "tab_id": {
                                                    "type": "integer",
                                                    "minimum": -9007199254740991,
                                                    "maximum": 9007199254740991,
                                                    "description": "The tab ID to close"
                                                }
                                            },
                                            "required": [
                                                "tab_id"
                                            ],
                                            "additionalProperties": false
                                        }
                                    },
                                    "required": [
                                        "close_tab"
                                    ],
                                    "additionalProperties": false,
                                    "description": "Close a tab by its ID. Cannot close the initial tab. Optionally specify which tab to switch to after closing."
                                }
                            ]
                        }
                    },
                    "required": [
                        "action"
                    ],
                    "additionalProperties": false
                }
            }
        }
    ],
    "parallel_tool_calls": false,
    "tool_choice": {
        "type": "function",
        "function": {
            "name": "AgentOutput"
        }
    },
    "enable_thinking": false
}

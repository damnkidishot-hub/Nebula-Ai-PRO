const fs = require('fs/promises');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const http = require('http');
const https = require('https');

const execPromise = util.promisify(exec);

// --- CONFIGURATION ---
const API_KEY = process.env.OPENROUTER_API_KEY || "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";
// FIX: Changed to a general-purpose model that handles normal chat well
const MODEL = process.env.MODEL || "meta-llama/llama-3.1-8b-instruct:free";

// --- TERMINAL UI COLORS ---
const colors = {
    reset: "\x1b[0m",
    cyan: "\x1b[36m",
    yellow: "\x1b[33m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    magenta: "\x1b[35m"
};

// --- STATE ---
let currentMode = 'normal';
let messageHistory = [{
    role: "system",
    content: "You are a highly capable AI assistant. Current date is " + new Date().toDateString() + ". Location: Bangladesh. When in Agent mode, you have access to tools to interact with the user's file system and execute commands. Use tools efficiently. If reading a file, use 'all' for the whole file, or 'startLine' and 'endLine' to read a specific portion. When editing a file, provide the exact 'startLine' and 'endLine' numbers, and the new 'content' to replace that section."
}];

// --- TOOLS SCHEMA ---
const agentTools = [
    {
        type: "function",
        function: {
            name: "read_file",
            description: "Read a file. Provide 'all': true to read the whole file, or 'startLine' and 'endLine' to read a specific portion.",
            parameters: {
                type: "object",
                properties: {
                    filepath: { type: "string", description: "Absolute or relative path to the file" },
                    all: { type: "boolean", description: "Set to true to read the entire file" },
                    startLine: { type: "integer", description: "Starting line number (1-indexed)" },
                    endLine: { type: "integer", description: "Ending line number" }
                },
                required: ["filepath"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "edit_file",
            description: "Edit a file by replacing a specific range of lines.",
            parameters: {
                type: "object",
                properties: {
                    filepath: { type: "string", description: "Path to the file" },
                    startLine: { type: "integer", description: "Starting line number to replace (1-indexed)" },
                    endLine: { type: "integer", description: "Ending line number to replace" },
                    content: { type: "string", description: "The new content that will replace the lines between startLine and endLine" }
                },
                required: ["filepath", "startLine", "endLine", "content"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "run_cmd",
            description: "Execute a command in the terminal.",
            parameters: {
                type: "object",
                properties: {
                    command: { type: "string", description: "The terminal command to run" }
                },
                required: ["command"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "create_item",
            description: "Create a new file or folder.",
            parameters: {
                type: "object",
                properties: {
                    targetPath: { type: "string", description: "Path for the new file or folder" },
                    type: { type: "string", enum: ["file", "folder"], description: "Type of item to create" },
                    content: { type: "string", description: "Optional content if creating a file" }
                },
                required: ["targetPath", "type"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "delete_item",
            description: "Delete a file or folder.",
            parameters: {
                type: "object",
                properties: {
                    targetPath: { type: "string", description: "Path to the file or folder to delete" }
                },
                required: ["targetPath"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "move_item",
            description: "Move or rename a file or folder.",
            parameters: {
                type: "object",
                properties: {
                    sourcePath: { type: "string", description: "Current path of the file or folder" },
                    destinationPath: { type: "string", description: "New path or name" }
                },
                required: ["sourcePath", "destinationPath"]
            }
        }
    }
];

// --- TOOL EXECUTION LOGIC ---
async function executeTool(name, args) {
    try {
        const parsedArgs = typeof args === 'string' ? JSON.parse(args) : args;
        const targetPath = parsedArgs.filepath || parsedArgs.targetPath || parsedArgs.sourcePath;
        const absolutePath = targetPath ? path.resolve(process.cwd(), targetPath) : null;

        switch (name) {
            case 'read_file': {
                const content = await fs.readFile(absolutePath, 'utf8');
                if (parsedArgs.all) return content;
                const lines = content.split('\n');
                const start = (parsedArgs.startLine || 1) - 1;
                const end = parsedArgs.endLine || lines.length;
                return lines.slice(start, end).join('\n');
            }
            case 'edit_file': {
                const content = await fs.readFile(absolutePath, 'utf8');
                const lines = content.split('\n');
                const startIdx = parsedArgs.startLine - 1;
                const deleteCount = parsedArgs.endLine - parsedArgs.startLine + 1;
                lines.splice(startIdx, deleteCount, parsedArgs.content);
                await fs.writeFile(absolutePath, lines.join('\n'), 'utf8');
                return 'Success: Edited ' + absolutePath + '. Replaced lines ' + parsedArgs.startLine + ' to ' + parsedArgs.endLine + '.';
            }
            case 'run_cmd': {
                const { stdout, stderr } = await execPromise(parsedArgs.command);
                return 'STDOUT:\n' + (stdout || 'None') + '\nSTDERR:\n' + (stderr || 'None');
            }
            case 'create_item': {
                if (parsedArgs.type === 'folder') {
                    await fs.mkdir(absolutePath, { recursive: true });
                    return 'Success: Folder created at ' + absolutePath;
                } else {
                    await fs.writeFile(absolutePath, parsedArgs.content || '', 'utf8');
                    return 'Success: File created at ' + absolutePath;
                }
            }
            case 'delete_item': {
                await fs.rm(absolutePath, { recursive: true, force: true });
                return 'Success: Deleted ' + absolutePath;
            }
            case 'move_item': {
                const destPath = path.resolve(process.cwd(), parsedArgs.destinationPath);
                await fs.rename(absolutePath, destPath);
                return 'Success: Moved/Renamed to ' + destPath;
            }
            default:
                return 'Error: Tool ' + name + ' not found.';
        }
    } catch (error) {
        return 'Error executing ' + name + ': ' + error.message;
    }
}

// --- FIX: Native HTTPS streaming (no fetch dependency, works on all Node versions) ---
function httpsPost(url, headers, body) {
    return new Promise(function(resolve, reject) {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'POST',
            headers: Object.assign({ 'Content-Length': Buffer.byteLength(body) }, headers)
        };
        const req = https.request(options, function(res) {
            resolve(res);
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// --- API CALL LOGIC WITH STREAMING ---
async function chatWithModel(messages, onChunk, onDone) {
    const payload = {
        model: MODEL,
        messages: messages,
        stream: true
    };

    if (currentMode === 'agent') {
        payload.tools = agentTools;
        payload.tool_choice = "auto";
    }

    const bodyStr = JSON.stringify(payload);

    const res = await httpsPost(
        "https://openrouter.ai/api/v1/chat/completions",
        {
            "Authorization": "Bearer " + API_KEY,
            "Content-Type": "application/json",
            "HTTP-Referer": "http://localhost:3000",
            "X-Title": "Nebula AI PRO"
        },
        bodyStr
    );

    if (res.statusCode !== 200) {
        let errText = '';
        for await (const chunk of res) {
            errText += chunk.toString();
        }
        throw new Error('API Error (' + res.statusCode + '): ' + errText);
    }

    let buffer = '';
    let finalContent = '';
    let toolCalls = [];

    for await (const chunk of res) {
        buffer += chunk.toString();
        let lines = buffer.split('\n');
        buffer = lines.pop();

        for (let line of lines) {
            line = line.trim();
            if (!line.startsWith('data: ')) continue;
            const dataStr = line.slice(6).trim();
            if (dataStr === '[DONE]') continue;

            try {
                const data = JSON.parse(dataStr);
                const delta = data.choices && data.choices[0] && data.choices[0].delta;
                if (!delta) continue;

                if (delta.content) {
                    finalContent += delta.content;
                    if (onChunk) onChunk(delta.content);
                }

                if (delta.tool_calls) {
                    for (let tc of delta.tool_calls) {
                        const idx = tc.index;
                        if (!toolCalls[idx]) {
                            toolCalls[idx] = { id: tc.id, type: 'function', function: { name: '', arguments: '' } };
                        }
                        if (tc.function && tc.function.name) toolCalls[idx].function.name += tc.function.name;
                        if (tc.function && tc.function.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
                    }
                }
            } catch (e) {
                // skip incomplete chunks
            }
        }
    }

    // Flush remaining buffer
    if (buffer.trim().startsWith('data: ')) {
        const dataStr = buffer.trim().slice(6).trim();
        if (dataStr && dataStr !== '[DONE]') {
            try {
                const data = JSON.parse(dataStr);
                const delta = data.choices && data.choices[0] && data.choices[0].delta;
                if (delta && delta.content) {
                    finalContent += delta.content;
                    if (onChunk) onChunk(delta.content);
                }
            } catch(e) {}
        }
    }

    const resultMessage = { role: "assistant", content: finalContent || null };
    const validToolCalls = toolCalls.filter(function(tc) { return tc !== undefined; });
    if (validToolCalls.length > 0) {
        resultMessage.tool_calls = validToolCalls;
    }

    return resultMessage;
}

// --- WEB SERVER ---
const server = http.createServer(async function(req, res) {
    if (req.url === '/' || req.url === '/index.html') {
        try {
            const content = await fs.readFile(path.join(__dirname, 'public', 'index.html'), 'utf8');
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(content);
        } catch (err) {
            res.writeHead(500);
            res.end('Error loading public/index.html.');
        }
    }
    else if (req.url === '/api/chat' && req.method === 'POST') {
        let body = '';
        req.on('data', function(chunk) { body += chunk.toString(); });
        req.on('end', async function() {
            let parsed;
            try {
                parsed = JSON.parse(body);
            } catch(e) {
                res.writeHead(400);
                res.end('Bad JSON');
                return;
            }

            const input = parsed.input;
            const mode = parsed.mode;

            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*'
            });

            currentMode = mode;
            messageHistory.push({ role: "user", content: input });

            // FIX: Track client abort separately; do NOT use req.on('close') to gate the loop
            let clientAborted = false;
            req.on('close', function() { clientAborted = true; });

            try {
                let isComplete = false;

                while (!isComplete && !clientAborted) {
                    const responseMessage = await chatWithModel(
                        messageHistory,
                        function(chunk) {
                            if (!clientAborted) {
                                res.write('data: ' + JSON.stringify({ type: 'chunk', content: chunk }) + '\n\n');
                            }
                        }
                    );

                    if (clientAborted) break;

                    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
                        messageHistory.push(responseMessage);
                        for (const toolCall of responseMessage.tool_calls) {
                            if (clientAborted) break;
                            const funcName = toolCall.function.name;
                            const funcArgs = toolCall.function.arguments;

                            res.write('data: ' + JSON.stringify({ type: 'tool_call', id: toolCall.id, name: funcName, args: funcArgs }) + '\n\n');

                            const toolResult = await executeTool(funcName, funcArgs);

                            res.write('data: ' + JSON.stringify({ type: 'tool_result', id: toolCall.id, result: String(toolResult) }) + '\n\n');

                            messageHistory.push({
                                tool_call_id: toolCall.id,
                                role: "tool",
                                name: funcName,
                                content: String(toolResult)
                            });
                        }
                    } else {
                        messageHistory.push(responseMessage);
                        isComplete = true;
                    }
                }

                if (!clientAborted) {
                    res.write('data: ' + JSON.stringify({ type: 'done' }) + '\n\n');
                }
                res.end();
            } catch (error) {
                console.error('Chat error:', error.message);
                if (!clientAborted) {
                    res.write('data: ' + JSON.stringify({ type: 'error', content: error.message }) + '\n\n');
                }
                res.end();
                messageHistory.pop();
            }
        });
    }
    else if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET', 'Access-Control-Allow-Headers': 'Content-Type' });
        res.end();
    }
    else {
        res.writeHead(404);
        res.end('Not found');
    }
});

server.listen(3000, function() {
    console.log(colors.cyan + 'Web interface running at http://localhost:3000' + colors.reset);
    console.log(colors.yellow + 'Set OPENROUTER_API_KEY env var to use your own key.' + colors.reset);
    console.log(colors.green + 'Set MODEL env var to change the AI model (default: meta-llama/llama-3.1-8b-instruct:free)' + colors.reset);
});

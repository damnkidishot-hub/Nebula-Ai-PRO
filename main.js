const readline = require('readline');
const fs = require('fs/promises');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const http = require('http'); // Added for the web server

const execPromise = util.promisify(exec);

// --- CONFIGURATION ---
const API_KEY = "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";
const MODEL = "poolside/laguna-xs.2:free";

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
let currentMode = 'normal'; // 'normal' | 'agent'
let messageHistory = [{
    role: "system",
    content: `You are a highly capable AI assistant inside a terminal. Current date is Friday, June 26, 2026. Location: Bangladesh. 
When in Agent mode, you have access to tools to interact with the user's file system and execute commands. 
Use tools efficiently. If reading a file, use 'all' for the whole file, or 'startLine' and 'endLine' to read a specific portion. 
When editing a file, provide the exact 'startLine' and 'endLine' numbers, and the new 'content' to replace that section.`
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
    // ADDED: Move tool as requested
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
                return `Success: Edited ${absolutePath}. Replaced lines ${parsedArgs.startLine} to ${parsedArgs.endLine}.`;
            }
            case 'run_cmd': {
                const { stdout, stderr } = await execPromise(parsedArgs.command);
                return `STDOUT:\n${stdout || 'None'}\nSTDERR:\n${stderr || 'None'}`;
            }
            case 'create_item': {
                if (parsedArgs.type === 'folder') {
                    await fs.mkdir(absolutePath, { recursive: true });
                    return `Success: Folder created at ${absolutePath}`;
                } else {
                    await fs.writeFile(absolutePath, parsedArgs.content || '', 'utf8');
                    return `Success: File created at ${absolutePath}`;
                }
            }
            case 'delete_item': {
                await fs.rm(absolutePath, { recursive: true, force: true });
                return `Success: Deleted ${absolutePath}`;
            }
            // ADDED: Move item logic
            case 'move_item': {
                const destPath = path.resolve(process.cwd(), parsedArgs.destinationPath);
                await fs.rename(absolutePath, destPath);
                return `Success: Moved/Renamed to ${destPath}`;
            }
            default:
                return `Error: Tool ${name} not found.`;
        }
    } catch (error) {
        return `Error executing ${name}: ${error.message}`;
    }
}

// --- API CALL LOGIC WITH STREAMING ---
async function chatWithModel(messages, onChunk) {
    const payload = {
        model: MODEL,
        messages: messages,
        stream: true
    };

    if (currentMode === 'agent') {
        payload.tools = agentTools;
        payload.tool_choice = "auto";
    }

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`API Error (${response.status}): ${errText}`);
    }

    const decoder = new TextDecoder("utf-8");
    let buffer = '';
    let finalContent = '';
    let toolCalls = [];

    // Process the stream
    for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let lines = buffer.split('\n');
        buffer = lines.pop(); // Keep the incomplete line in the buffer

        for (let line of lines) {
            line = line.trim();
            if (line.startsWith('data: ')) {
                const dataStr = line.slice(6).trim();
                if (dataStr === '[DONE]') continue;
                
                try {
                    const data = JSON.parse(dataStr);
                    const delta = data.choices[0]?.delta;
                    
                    if (!delta) continue;

                    // Handle text content streaming
                    if (delta.content) {
                        finalContent += delta.content;
                        if (onChunk) onChunk(delta.content);
                    }

                    // Handle tool call streaming (reconstructing chunks)
                    if (delta.tool_calls) {
                        for (let tc of delta.tool_calls) {
                            let idx = tc.index;
                            if (!toolCalls[idx]) {
                                toolCalls[idx] = { 
                                    id: tc.id, 
                                    type: 'function', 
                                    function: { name: '', arguments: '' } 
                                };
                            }
                            if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
                            if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
                        }
                    }
                } catch (e) {
                    // Silently ignore incomplete JSON chunks that will be resolved in next line
                }
            }
        }
    }

    // Construct the final message block to add to history
    const resultMessage = { role: "assistant", content: finalContent || null };
    
    // Filter out any sparse array slots just in case
    const validToolCalls = toolCalls.filter(tc => tc !== undefined);
    if (validToolCalls.length > 0) {
        resultMessage.tool_calls = validToolCalls;
    }

    return resultMessage;
}

// --- WEB SERVER (ADDED FOR FRONTEND UI) ---
const server = http.createServer(async (req, res) => {
    // Serve the frontend file
    if (req.url === '/' || req.url === '/index.html') {
        try {
            const content = await fs.readFile(path.join(__dirname, 'public', 'index.html'), 'utf8');
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(content);
        } catch (err) {
            res.writeHead(500);
            res.end('Error loading public/index.html. Make sure the file exists.');
        }
    } 
// ... existing code ...
    // Handle Chat API requests from the frontend
    else if (req.url === '/api/chat' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            const { input, mode } = JSON.parse(body);
            
            // Set up Server-Sent Events (SSE) stream to the browser
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive'
            });

            currentMode = mode; // Sync the mode from UI
            messageHistory.push({ role: "user", content: input });

            try {
                let isComplete = false;
                
                // Watch for client disconnect / stop button pressed
                req.on('close', () => {
                    isComplete = true; 
                });

                while (!isComplete) {
                    const responseMessage = await chatWithModel(messageHistory, (chunk) => {
                        if (!isComplete) {
                            res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`);
                        }
                    });

                    if (isComplete) break; // Terminate early if the client aborted

                    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
                        messageHistory.push(responseMessage);
                        for (const toolCall of responseMessage.tool_calls) {
                            const funcName = toolCall.function.name;
                            const funcArgs = toolCall.function.arguments;
                            
                            // Send structured tool call info to UI
                            res.write(`data: ${JSON.stringify({ type: 'tool_call', id: toolCall.id, name: funcName, args: funcArgs })}\n\n`);
                            
                            const toolResult = await executeTool(funcName, funcArgs);
                            
                            // Send structured tool result to UI
                            res.write(`data: ${JSON.stringify({ type: 'tool_result', id: toolCall.id, result: String(toolResult) })}\n\n`);
                            
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
                res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
                res.end();
            } catch (error) {
                res.write(`data: ${JSON.stringify({ type: 'error', content: error.message })}\n\n`);
                res.end();
                messageHistory.pop();
            }
        });
    } else {
        res.writeHead(404);
        res.end();
    }
});

server.listen(3000, () => {
    console.log(`${colors.cyan}🌐 Web interface running at http://localhost:3000${colors.reset}`);
    console.log(`${colors.yellow}⚠️ Terminal interface has been disabled as requested. Please use the web UI!${colors.reset}`);
});
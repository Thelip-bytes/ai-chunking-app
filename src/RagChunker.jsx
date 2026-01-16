import React, { useState, useRef } from 'react';
import { Upload, FileText, Download, Settings, Scissors, Database, RefreshCw, Check, Brain, Zap, StopCircle, AlertTriangle, Globe, Tag, Layers, Hash } from 'lucide-react';

const Card = ({ children, className = "" }) => (
    <div className={`bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden ${className}`}>
        {children}
    </div>
);

const Button = ({ children, onClick, variant = "primary", disabled = false, icon: Icon, className = "" }) => {
    const baseStyle = "px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed";
    const variants = {
        primary: "bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-600/20",
        secondary: "bg-white border border-slate-300 hover:bg-slate-50 text-slate-700",
        ghost: "bg-transparent hover:bg-slate-100 text-slate-600",
        success: "bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/20",
        danger: "bg-red-500 hover:bg-red-600 text-white shadow-md shadow-red-500/20"
    };

    return (
        <button onClick={onClick} disabled={disabled} className={`${baseStyle} ${variants[variant]} ${className}`}>
            {Icon && <Icon size={18} />}
            {children}
        </button>
    );
};

// --- UTILS ---

const countTokens = (text) => {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
};

const generateUUID = () => {
    return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2) + Date.now().toString(36);
};

// Generate a short abbreviation from document title for unique chunk naming
const generateDocAbbreviation = (title) => {
    if (!title) return "DOC";
    // Get first letter of each word, uppercase, max 6 characters
    const words = title.replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 0);
    if (words.length === 0) return "DOC";

    // If single word, take first 4-6 chars
    if (words.length === 1) {
        return words[0].substring(0, 6).toUpperCase();
    }

    // Otherwise, take first letter of each word (up to 6 words)
    const abbrev = words.slice(0, 6).map(w => w[0]).join('').toUpperCase();
    return abbrev || "DOC";
};

// Generate unique chunk title combining doc abbreviation + section title
const generateUniqueChunkTitle = (docTitle, sectionTitle, chunkIndex, totalChunks) => {
    const abbrev = generateDocAbbreviation(docTitle);
    const section = sectionTitle || `Chunk ${chunkIndex + 1}`;

    // If section title is same as doc title, add chunk number
    if (section === docTitle || section === "Untitled Section") {
        return `[${abbrev}] Part ${chunkIndex + 1}/${totalChunks}`;
    }

    return `[${abbrev}] ${section}`;
};

// --- POST-PROCESSING & VALIDATION LAYER ---
// Input: Array of chunk OBJECTS from LLM (or Strings from recursive fallback)
// Output: Array of validated, standardized chunk OBJECTS
const postProcessChunks = (rawChunks, originalText, fileMeta) => {
    if (!rawChunks || rawChunks.length === 0) return [];

    const normalize = (str) => str.replace(/\s+/g, ' ').trim();
    const normOriginal = normalize(originalText);

    // 1. Normalize Input (Handle AI objects vs Recursive strings)
    let normalizedChunks = rawChunks.map((c, i) => {
        if (typeof c === 'string') {
            return {
                text: c,
                title: fileMeta.title || "Untitled Section",
                chunk_type: "concept", // default
                programs: [],
                topics: []
            };
        }
        return {
            text: c.text || "",
            title: c.title || fileMeta.title || "Untitled Section",
            chunk_type: c.chunk_type || "concept",
            programs: c.programs || [],
            topics: c.topics || []
        };
    });

    // 2. HARD DELETE: Metadata & Noise Regex
    const FORBIDDEN_PATTERNS = [
        /^(Related topics|More information|See also|About this guide|Intended audience|Document structure|Copyright|Legal info)/i,
        /^Page not found/i,
        /^Error \d+/i,
        /^javascript:void/i
    ];

    let cleanChunks = normalizedChunks.filter(chunk => {
        const text = chunk.text;
        const headerSnippet = text.trim().substring(0, 100);

        if (FORBIDDEN_PATTERNS.some(regex => regex.test(headerSnippet))) return false;

        const normChunk = normalize(text);
        if (normChunk.length === 0) return false;

        // STRICT Substring Check
        if (!normOriginal.includes(normChunk)) {
            console.warn("Rejecting hallucinated chunk:", text.substring(0, 30) + "...");
            return false;
        }
        return true;
    });

    // 3. SMART MERGE: Repair tiny fragments (Object-aware)
    if (cleanChunks.length === 0) return [];

    const merged = [];
    let buffer = cleanChunks[0];

    const sectionStarters = [
        "Overview", "Background", "Outcome", "Before you start",
        "Parameters to set", "Follow these steps", "Example", "Simulation", "Settings description"
    ];

    for (let i = 1; i < cleanChunks.length; i++) {
        const next = cleanChunks[i];
        const bufferTokens = countTokens(buffer.text);
        const nextTokens = countTokens(next.text);

        const startsWithHeading = sectionStarters.some(h => next.text.trim().startsWith(h));

        // Rules for merging
        const isBufferTooSmall = bufferTokens < 120;
        const isBufferHeading = buffer.text.split('\n').length <= 2 && bufferTokens < 50;
        const isNextTableFragment = next.text.includes('|') && !next.text.includes('\n\n');
        const isNextTooSmall = nextTokens < 50;

        // Merge Logic for Objects
        if (!startsWithHeading && (isBufferTooSmall || isBufferHeading || isNextTableFragment || isNextTooSmall)) {
            buffer = {
                ...buffer,
                text: buffer.text + "\n\n" + next.text,
                // Merge tags
                programs: [...new Set([...buffer.programs, ...next.programs])],
                topics: [...new Set([...buffer.topics, ...next.topics])],
                // Keep the "dominant" type or title (usually the start of the section)
            };
        } else {
            merged.push(buffer);
            buffer = next;
        }
    }
    merged.push(buffer);

    // 4. Final Schema Assembly with Unique Titles
    const docTitle = fileMeta.title || "Untitled Document";

    return merged.map((chunk, idx) => {
        const uniqueTitle = generateUniqueChunkTitle(docTitle, chunk.title, idx, merged.length);

        return {
            id: generateUUID(),
            bucket: "official", // Hardcoded per requirement
            chunk_type: chunk.chunk_type,
            title: uniqueTitle,
            original_doc_title: docTitle, // Keep original for reference
            source: {
                document_id: fileMeta.file || "unknown",
                section: chunk.title, // Original section title
                version: "M3 Cloud", // Placeholder
                url: fileMeta.url || ""
            },
            content: {
                text: chunk.text,
                steps: [] // Future proofing
            },
            tags: {
                module: ["Finance"], // Can be dynamic later
                programs: chunk.programs,
                topics: chunk.topics,
                client_scope: "global",
                confidence: "official"
            },
            chunk_index: idx,
            chunk_count: merged.length,
            chunk_tokens: countTokens(chunk.text)
        };
    });
};

// --- CHUNKING STRATEGIES ---

const splitTextRecursive = (text, chunkSize) => {
    if (!text) return [];
    const separators = ["\n\n", "\n", ". ", "? ", "! ", " ", ""];

    const splitRecursively = (currentText, sepIndex) => {
        const separator = separators[sepIndex];
        let splits = separator === "" ? Array.from(currentText) : currentText.split(separator);
        let goodSplits = [];
        let currentDoc = "";

        for (const s of splits) {
            const sWithSep = separator === "" ? s : (separator.trim() === "" ? s + separator : s + separator);
            const potentialDoc = currentDoc + sWithSep;

            if (countTokens(potentialDoc) > chunkSize) {
                if (currentDoc) {
                    goodSplits.push(currentDoc);
                    currentDoc = "";
                }
                if (countTokens(sWithSep) > chunkSize && sepIndex < separators.length - 1) {
                    goodSplits.push(...splitRecursively(sWithSep, sepIndex + 1));
                } else {
                    currentDoc = sWithSep;
                }
            } else {
                currentDoc = potentialDoc;
            }
        }
        if (currentDoc) goodSplits.push(currentDoc);
        return goodSplits;
    };

    const rawChunks = splitRecursively(text, 0);
    return rawChunks; // Returns array of strings
};

// 2. AI-Based (OpenRouter)
const chunkWithOpenRouter = async (text, title, apiKey, modelName) => {
    if (countTokens(text) < 50) return [text];

    const url = "https://openrouter.ai/api/v1/chat/completions";

    // Consultant Copilot Context Prompt - STRUCTURED
    const prompt = `
PROJECT CONTEXT:
You are a "Librarian AI" for an Infor M3 ERP Consultant Copilot.
Your job is to segment document text into structured knowledge chunks.

MANDATORY RULES:
1. CONTENT: Use EXACT original text. DO NOT rewrite.
2. BOUNDARIES: Split by logical sections (Overview, Procedure, Example).
3. INTEGRITY: Keep tables with their explanations. Keep examples with concepts.
4. METADATA: Discard "Related topics", "Copyright", etc.

CLASSIFICATION RULES:
- chunk_type: "concept" (definitions), "procedure" (steps), "example" (scenarios), "reference" (tables/codes).
- programs: Extract M3 program codes (e.g., CRS610, MNS100) found in the text.
- topics: Extract key business topics (e.g., "VAT", "Authorization").

OUTPUT FORMAT (STRICT JSON):
{
  "chunks": [
    {
      "chunk_type": "concept",
      "title": "Section Title",
      "text": "EXACT original text substring...",
      "programs": ["CRS610"],
      "topics": ["Settings"]
    }
  ]
}

Document Title: "${title}"

Text to Process:
"${text.substring(0, 15000).replace(/"/g, '\\"')}" 
`;

    return new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", url, true);
        xhr.setRequestHeader("Authorization", `Bearer ${apiKey.trim()}`);
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.setRequestHeader("HTTP-Referer", "https://rag-chunker.local");
        xhr.setRequestHeader("X-Title", "RAG Data Chunker");

        xhr.onreadystatechange = () => {
            if (xhr.readyState === 4) {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        const data = JSON.parse(xhr.responseText);
                        const content = data.choices?.[0]?.message?.content || "";
                        let jsonStr = content.trim().replace(/```json/g, '').replace(/```/g, '');

                        let parsed = null;
                        const firstBrace = jsonStr.indexOf('{');
                        const lastBrace = jsonStr.lastIndexOf('}');
                        if (firstBrace !== -1 && lastBrace !== -1) {
                            try { parsed = JSON.parse(jsonStr.substring(firstBrace, lastBrace + 1)); } catch (e) { }
                        }
                        if (!parsed) {
                            // Fallback: try finding just the array part
                            const firstBracket = jsonStr.indexOf('[');
                            const lastBracket = jsonStr.lastIndexOf(']');
                            if (firstBracket !== -1 && lastBracket !== -1) {
                                try {
                                    const arr = JSON.parse(jsonStr.substring(firstBracket, lastBracket + 1));
                                    if (Array.isArray(arr)) parsed = { chunks: arr };
                                } catch (e) { }
                            }
                        }

                        if (parsed && Array.isArray(parsed.chunks)) {
                            resolve(parsed.chunks);
                        } else {
                            console.warn("AI JSON parse failed, falling back to original");
                            resolve([text]); // Fallback to string array
                        }
                    } catch (e) {
                        console.error("AI Response Parse Error:", e);
                        resolve([text]);
                    }
                } else {
                    resolve([text]);
                }
            }
        };
        xhr.send(JSON.stringify({
            model: modelName || "xiaomi/mimo-v2-flash:free",
            messages: [
                { role: "system", content: "You are a strict data structuring engine. Output valid JSON only." },
                { role: "user", content: prompt }
            ]
        }));
    });
};


export default function RagChunker() {
    const [file, setFile] = useState(null);
    const [jsonData, setJsonData] = useState([]);
    const [processedData, setProcessedData] = useState([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [view, setView] = useState('input');
    const [progress, setProgress] = useState(0);
    const abortControllerRef = useRef(null);

    const [config, setConfig] = useState({
        mode: 'recursive',
        chunkSize: 512,
        apiKey: '',
        modelName: 'xiaomi/mimo-v2-flash:free',
    });

    const [stats, setStats] = useState({
        totalFiles: 0,
        totalOriginalTokens: 0,
        totalChunks: 0,
        totalChunkTokens: 0
    });

    const handleFileUpload = (e) => {
        const uploadedFile = e.target.files[0];
        if (uploadedFile) {
            setFile(uploadedFile);
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const json = JSON.parse(event.target.result);
                    const dataArray = Array.isArray(json) ? json : [json];
                    setJsonData(dataArray);
                    setStats(s => ({ ...s, totalFiles: dataArray.length }));
                    setProcessedData([]);
                } catch (error) {
                    alert("Invalid JSON file");
                }
            };
            reader.readAsText(uploadedFile);
        }
    };

    const stopProcessing = () => {
        if (abortControllerRef.current) abortControllerRef.current.abort();
        setIsProcessing(false);
    };

    const processChunks = async () => {
        if (jsonData.length === 0) return;
        if (config.mode === 'ai' && !config.apiKey) {
            alert("Please enter an OpenRouter API Key for AI chunking.");
            return;
        }

        setIsProcessing(true);
        setProcessedData([]);
        setProgress(0);
        setView('preview');

        abortControllerRef.current = new AbortController();
        const { signal } = abortControllerRef.current;

        let newStats = {
            totalFiles: jsonData.length,
            totalOriginalTokens: 0,
            totalChunks: 0,
            totalChunkTokens: 0
        };

        let tempResults = [];

        for (let i = 0; i < jsonData.length; i++) {
            if (signal.aborted) break;

            const item = jsonData[i];
            const text = item.text || "";
            const originalTokens = countTokens(text);
            newStats.totalOriginalTokens += originalTokens;

            let rawChunks = [];

            try {
                if (config.mode === 'ai') {
                    // AI returns Objects now
                    rawChunks = await chunkWithOpenRouter(text, item.title, config.apiKey, config.modelName);
                    await new Promise(r => setTimeout(r, 1000));
                } else {
                    // Recursive returns strings
                    rawChunks = splitTextRecursive(text, config.chunkSize);
                }
            } catch (err) {
                console.error("Error processing item", i, err);
                rawChunks = [text];
            }

            // Pass File Metadata for Source tagging
            const finalChunks = postProcessChunks(rawChunks, text, {
                title: item.title,
                file: item.file,
                url: item.url
            });

            finalChunks.forEach((chunk) => {
                newStats.totalChunkTokens += chunk.chunk_tokens;
                newStats.totalChunks += 1;
                tempResults.push(chunk);
            });

            setProcessedData([...tempResults]);
            setStats({ ...newStats });
            setProgress(((i + 1) / jsonData.length) * 100);
        }

        setIsProcessing(false);
    };

    const downloadJson = () => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(processedData, null, 2));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", `rag_chunks_${config.mode}.json`);
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
    };

    return (
        <div className="min-h-screen bg-slate-50 text-slate-800 p-6 font-sans">
            <div className="max-w-6xl mx-auto space-y-6">

                {/* Header */}
                <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
                            <Database className="text-blue-600" />
                            RAG Data Chunker
                        </h1>
                        <p className="text-slate-500 mt-1">Transform scraped data into semantic chunks for Vector DBs.</p>
                    </div>
                    <div className="flex gap-3">
                        {processedData.length > 0 && (
                            <Button onClick={downloadJson} icon={Download} variant="success">
                                Download JSON
                            </Button>
                        )}
                    </div>
                </header>

                {/* Main Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                    {/* Left Column: Input & Config */}
                    <div className="space-y-6">

                        {/* 1. Upload */}
                        <Card className="p-6">
                            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                                <FileText size={20} className="text-slate-400" />
                                1. Input Data
                            </h2>
                            <div className="border-2 border-dashed border-slate-200 rounded-lg p-8 text-center hover:bg-slate-50 transition-colors relative">
                                <input
                                    type="file"
                                    accept=".json"
                                    onChange={handleFileUpload}
                                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                                />
                                <div className="flex flex-col items-center gap-2 pointer-events-none">
                                    <Upload className="text-blue-500 mb-2" size={32} />
                                    <span className="font-medium text-slate-700">
                                        {file ? file.name : "Drop JSON file here"}
                                    </span>
                                    <span className="text-xs text-slate-400">
                                        {file ? `${(file.size / 1024).toFixed(1)} KB` : "Accepts array of objects"}
                                    </span>
                                </div>
                            </div>

                            {jsonData.length > 0 && (
                                <div className="mt-4 p-3 bg-blue-50 text-blue-800 text-sm rounded flex items-center justify-between">
                                    <span>loaded <strong>{jsonData.length}</strong> documents</span>
                                    <Check size={16} />
                                </div>
                            )}
                        </Card>

                        {/* 2. Configuration */}
                        <Card className="p-6">
                            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                                <Settings size={20} className="text-slate-400" />
                                2. Processing Mode
                            </h2>

                            <div className="space-y-4">
                                {/* Mode Toggle */}
                                <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-lg">
                                    <button
                                        onClick={() => setConfig({ ...config, mode: 'recursive' })}
                                        className={`flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-all ${config.mode === 'recursive' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                                    >
                                        <Zap size={16} />
                                        Fast (Regex)
                                    </button>
                                    <button
                                        onClick={() => setConfig({ ...config, mode: 'ai' })}
                                        className={`flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-all ${config.mode === 'ai' ? 'bg-white text-purple-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                                    >
                                        <Globe size={16} />
                                        Smart (OpenRouter)
                                    </button>
                                </div>
                            </div>

                            {config.mode === 'recursive' ? (
                                // Recursive Settings
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">
                                        Max Token Size
                                    </label>
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="range"
                                            min="128"
                                            max="2048"
                                            step="64"
                                            value={config.chunkSize}
                                            onChange={(e) => setConfig({ ...config, chunkSize: Number(e.target.value) })}
                                            className="flex-1 accent-blue-600"
                                        />
                                        <span className="w-16 text-right font-mono text-slate-600">{config.chunkSize}</span>
                                    </div>
                                    <p className="text-xs text-slate-400 mt-1">Faster, but splits strictly by size/grammar.</p>
                                </div>
                            ) : (
                                // AI Settings
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">
                                            OpenRouter API Key
                                        </label>
                                        <input
                                            type="password"
                                            placeholder="sk-or-..."
                                            value={config.apiKey}
                                            onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
                                            className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">
                                            Model Name
                                        </label>
                                        <input
                                            type="text"
                                            placeholder="e.g., xiaomi/mimo-v2-flash:free"
                                            value={config.modelName}
                                            onChange={(e) => setConfig({ ...config, modelName: e.target.value })}
                                            className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none font-mono"
                                        />
                                        <p className="text-xs text-slate-400 mt-1">
                                            Try <code>google/gemini-2.0-flash-exp:free</code> or <code>xiaomi/mimo-v2-flash:free</code>
                                        </p>
                                    </div>

                                    <div className="p-3 bg-purple-50 text-purple-800 text-xs rounded border border-purple-100">
                                        <strong>AI Judge:</strong> The model will read the content to find semantic breakpoints.
                                    </div>
                                </div>
                            )}

                            <div className="mt-6 space-y-2">
                                {!isProcessing ? (
                                    <Button
                                        onClick={processChunks}
                                        disabled={!file}
                                        className={`w-full justify-center ${config.mode === 'ai' ? 'bg-purple-600 hover:bg-purple-700 shadow-purple-600/20' : ''}`}
                                        icon={config.mode === 'ai' ? Brain : Scissors}
                                    >
                                        {config.mode === 'ai' ? "Judge & Chunk with AI" : "Chunk Data"}
                                    </Button>
                                ) : (
                                    <Button
                                        onClick={stopProcessing}
                                        variant="danger"
                                        className="w-full justify-center"
                                        icon={StopCircle}
                                    >
                                        Stop Processing
                                    </Button>
                                )}

                                {isProcessing && (
                                    <div className="w-full bg-slate-200 rounded-full h-2.5 mt-2">
                                        <div className="bg-blue-600 h-2.5 rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
                                    </div>
                                )}
                            </div>
                        </Card>

                        {/* Stats Summary */}
                        {(processedData.length > 0 || isProcessing) && (
                            <Card className="p-6 bg-slate-800 text-white border-slate-700">
                                <h2 className="text-lg font-semibold mb-4 text-slate-200">Processing Stats</h2>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <div className="text-2xl font-bold text-blue-400">{stats.totalOriginalTokens.toLocaleString()}</div>
                                        <div className="text-xs text-slate-400">Total Input Tokens</div>
                                    </div>
                                    <div>
                                        <div className="text-2xl font-bold text-emerald-400">{stats.totalChunks.toLocaleString()}</div>
                                        <div className="text-xs text-slate-400">Generated Chunks</div>
                                    </div>
                                    <div>
                                        <div className="text-2xl font-bold text-purple-400">{stats.totalChunkTokens.toLocaleString()}</div>
                                        <div className="text-xs text-slate-400">Total Chunk Tokens</div>
                                    </div>
                                    <div>
                                        <div className="text-2xl font-bold text-orange-400">{(stats.totalChunks / (stats.totalFiles || 1)).toFixed(1)}</div>
                                        <div className="text-xs text-slate-400">Avg Chunks / Doc</div>
                                    </div>
                                </div>
                            </Card>
                        )}

                    </div>

                    {/* Right Column: Preview */}
                    <div className="lg:col-span-2 flex flex-col h-[600px]">
                        <Card className="flex-1 flex flex-col h-full">
                            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                                <h3 className="font-semibold text-slate-700">
                                    {view === 'input' ? 'Input Preview' : 'Output Chunks Preview'}
                                </h3>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setView('input')}
                                        className={`text-xs px-3 py-1 rounded-full ${view === 'input' ? 'bg-blue-100 text-blue-700 font-medium' : 'text-slate-500 hover:bg-slate-100'}`}
                                    >
                                        Original
                                    </button>
                                    <button
                                        onClick={() => setView('preview')}
                                        disabled={processedData.length === 0}
                                        className={`text-xs px-3 py-1 rounded-full ${view === 'preview' ? 'bg-blue-100 text-blue-700 font-medium' : 'text-slate-500 hover:bg-slate-100'}`}
                                    >
                                        Processed
                                    </button>
                                </div>
                            </div>

                            <div className="flex-1 overflow-auto p-4 bg-slate-50/50">
                                {view === 'input' ? (
                                    jsonData.length > 0 ? (
                                        <div className="space-y-4">
                                            {jsonData.slice(0, 10).map((item, idx) => (
                                                <div key={idx} className="bg-white p-4 rounded border border-slate-200 shadow-sm">
                                                    <div className="flex justify-between items-start mb-2">
                                                        <span className="font-mono text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded">{item.file}</span>
                                                        <span className="text-xs text-slate-400">~{countTokens(item.text)} tokens</span>
                                                    </div>
                                                    <div className="text-sm font-semibold text-slate-800 mb-1">{item.title}</div>
                                                    <p className="text-sm text-slate-600 line-clamp-3 font-mono">{item.text}</p>
                                                </div>
                                            ))}
                                            {jsonData.length > 10 && (
                                                <div className="text-center text-sm text-slate-400 py-4 italic">
                                                    Showing first 10 of {jsonData.length} documents...
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="h-full flex flex-col items-center justify-center text-slate-400">
                                            <FileText size={48} className="mb-4 opacity-20" />
                                            <p>Upload a file to see preview</p>
                                        </div>
                                    )
                                ) : (
                                    // OUTPUT PREVIEW
                                    processedData.length > 0 ? (
                                        <div className="space-y-4">
                                            {processedData.slice(0, 50).map((chunk, idx) => {
                                                const isTooBig = chunk.chunk_tokens > 900;
                                                const isTiny = chunk.chunk_tokens < 50;

                                                const tagColors = {
                                                    procedure: 'text-purple-600 bg-purple-50',
                                                    example: 'text-orange-600 bg-orange-50',
                                                    reference: 'text-blue-600 bg-blue-50',
                                                    concept: 'text-slate-600 bg-slate-100',
                                                    unknown: 'text-slate-400 bg-slate-50'
                                                };

                                                const TagIcon = chunk.chunk_type === 'procedure' ? Zap :
                                                    chunk.chunk_type === 'example' ? Brain :
                                                        chunk.chunk_type === 'reference' ? Database : Tag;

                                                return (
                                                    <div key={idx} className={`bg-white p-4 rounded border shadow-sm hover:border-blue-300 transition-colors ${isTooBig ? 'border-amber-300 bg-amber-50' : 'border-slate-200'}`}>
                                                        <div className="flex justify-between items-start mb-3">
                                                            <div className="flex-1">
                                                                <div className="flex items-center gap-2 mb-1">
                                                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1 uppercase tracking-wider ${tagColors[chunk.chunk_type] || tagColors.unknown}`}>
                                                                        <TagIcon size={10} /> {chunk.chunk_type}
                                                                    </span>
                                                                    <span className="font-semibold text-sm text-slate-800 line-clamp-1">{chunk.title}</span>
                                                                </div>
                                                                <div className="flex flex-wrap gap-1 mt-1">
                                                                    {chunk.tags.programs.map(p => (
                                                                        <span key={p} className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded border border-blue-200 flex items-center gap-0.5">
                                                                            <Hash size={8} /> {p}
                                                                        </span>
                                                                    ))}
                                                                    {chunk.tags.topics.map(t => (
                                                                        <span key={t} className="text-[9px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border border-slate-200 flex items-center gap-0.5">
                                                                            <Layers size={8} /> {t}
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                {isTooBig && (
                                                                    <span className="text-[10px] text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded flex items-center gap-1" title="This chunk is very large.">
                                                                        <AlertTriangle size={10} /> Large
                                                                    </span>
                                                                )}
                                                                {!isTooBig && (
                                                                    <span className={`text-xs font-medium px-2 py-0.5 rounded ${isTiny ? 'text-slate-500 bg-slate-100' : 'text-emerald-600 bg-emerald-50'}`}>
                                                                        {chunk.chunk_tokens} tok
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>

                                                        <div className="relative">
                                                            <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-full opacity-50 ${isTooBig ? 'bg-amber-500' : (config.mode === 'ai' ? 'bg-purple-500' : 'bg-blue-500')}`}></div>
                                                            <p className="pl-4 text-xs text-slate-700 leading-relaxed font-mono whitespace-pre-wrap max-h-60 overflow-y-auto">
                                                                {chunk.content.text}
                                                            </p>
                                                        </div>

                                                        <div className="mt-2 pt-2 border-t border-slate-50 flex justify-between text-[10px] text-slate-400 font-mono">
                                                            <span className="truncate max-w-[150px]">{chunk.id.substring(0, 8)}...</span>
                                                            <span className="truncate max-w-[200px]">{chunk.source.document_id}</span>
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    ) : (
                                        <div className="h-full flex flex-col items-center justify-center text-slate-400">
                                            {isProcessing ? (
                                                <div className="flex flex-col items-center animate-pulse">
                                                    <RefreshCw size={48} className="mb-4 text-purple-400 animate-spin" />
                                                    <p>AI is judging your content...</p>
                                                </div>
                                            ) : (
                                                <>
                                                    <Scissors size={48} className="mb-4 opacity-20" />
                                                    <p>Process the data to see chunks</p>
                                                </>
                                            )}
                                        </div>
                                    )
                                )}
                            </div>
                        </Card>
                    </div>
                </div>
            </div>
        </div>
    );
}

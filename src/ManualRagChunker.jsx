import React, { useState, useRef, useEffect } from 'react';
import { Upload, FileText, Download, Settings, Scissors, Database, RefreshCw, Check, Brain, Zap, StopCircle, AlertTriangle, Globe, Tag, Layers, Hash, Play, FastForward, SkipForward, ArrowRight, RotateCcw } from 'lucide-react';

const Card = ({ children, className = "" }) => (
    <div className={`bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden ${className}`}>
        {children}
    </div>
);

const Button = ({ children, onClick, variant = "primary", disabled = false, icon: Icon, className = "", size = "md" }) => {
    const baseStyle = "rounded-lg font-medium transition-all duration-200 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed justify-center";
    const sizes = {
        sm: "px-3 py-1.5 text-sm",
        md: "px-4 py-2",
        lg: "px-6 py-3 text-lg"
    };

    const variants = {
        primary: "bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-600/20",
        secondary: "bg-white border border-slate-300 hover:bg-slate-50 text-slate-700",
        ghost: "bg-transparent hover:bg-slate-100 text-slate-600",
        success: "bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/20",
        danger: "bg-red-500 hover:bg-red-600 text-white shadow-md shadow-red-500/20",
        warning: "bg-amber-500 hover:bg-amber-600 text-white shadow-md shadow-amber-500/20"
    };

    return (
        <button onClick={onClick} disabled={disabled} className={`${baseStyle} ${sizes[size]} ${variants[variant]} ${className}`}>
            {Icon && <Icon size={size === 'sm' ? 16 : 18} />}
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

// --- POST-PROCESSING (Duplicated to maintain isolation) ---
const postProcessChunks = (rawChunks, originalText, fileMeta) => {
    if (!rawChunks || rawChunks.length === 0) return [];

    const normalize = (str) => str.replace(/\s+/g, ' ').trim();
    const leadingText = originalText.substring(0, 100);

    let normalizedChunks = rawChunks.map((c) => {
        if (typeof c === 'string') {
            return {
                text: c,
                title: fileMeta.title || "Untitled Section",
                chunk_type: "concept",
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
        if (text.length < 10) return false;
        return true;
    });

    // 3. SMART MERGE: Repair tiny fragments
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

        if (!startsWithHeading && (isBufferTooSmall || isBufferHeading || isNextTableFragment || isNextTooSmall)) {
            buffer = {
                ...buffer,
                text: buffer.text + "\n\n" + next.text,
                programs: [...new Set([...buffer.programs, ...next.programs])],
                topics: [...new Set([...buffer.topics, ...next.topics])],
            };
        } else {
            merged.push(buffer);
            buffer = next;
        }
    }
    merged.push(buffer);

    // 4. Final Schema Assembly with Unique Titles
    // Generate unique titles by combining document abbreviation with section titles
    const docTitle = fileMeta.title || "Untitled Document";

    return merged.map((chunk, idx) => {
        const uniqueTitle = generateUniqueChunkTitle(docTitle, chunk.title, idx, merged.length);

        return {
            id: generateUUID(),
            bucket: "manual_ai",
            chunk_type: chunk.chunk_type,
            title: uniqueTitle,
            original_doc_title: docTitle, // Keep original for reference
            source: {
                document_id: fileMeta.file || "unknown",
                section: chunk.title, // Original section title
                version: "M3 Cloud",
                url: fileMeta.url || ""
            },
            content: {
                text: chunk.text,
                steps: []
            },
            tags: {
                module: ["Finance"],
                programs: chunk.programs,
                topics: chunk.topics,
                client_scope: "global",
                confidence: "reviewed" // Marked as reviewed since manual
            },
            chunk_index: idx, // Relative to doc
            chunk_tokens: countTokens(chunk.text)
        };
    });
};

// --- CHUNKING ---
const chunkWithOpenRouter = async (text, title, apiKey, modelName) => {
    if (countTokens(text) < 50) return [{ text, title, chunk_type: "concept", programs: [], topics: [] }];

    const url = "https://openrouter.ai/api/v1/chat/completions";

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
                        // Fallback for array
                        if (!parsed) {
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
                            resolve([{ text, title, chunk_type: "concept" }]);
                        }
                    } catch (e) {
                        console.error("AI Response Parse Error:", e);
                        resolve([{ text, title, chunk_type: "concept" }]);
                    }
                } else {
                    resolve([{ text, title, chunk_type: "concept" }]);
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

export default function ManualRagChunker({ onBack }) { // onBack prop to switch mode if needed
    const [file, setFile] = useState(null);
    const [jsonData, setJsonData] = useState([]);

    // Processing State
    const [currentIndex, setCurrentIndex] = useState(-1); // -1 = not started
    const [processedChunks, setProcessedChunks] = useState([]); // All accepted chunks
    const [currentDocChunks, setCurrentDocChunks] = useState(null); // Chunks for current doc (pending)
    const [isProcessing, setIsProcessing] = useState(false);
    const [autoComplete, setAutoComplete] = useState(false);

    const abortControllerRef = useRef(null);

    const [config, setConfig] = useState({
        apiKey: '',
        modelName: 'xiaomi/mimo-v2-flash:free',
    });

    // Calculate current doc stats
    const currentDoc = currentIndex >= 0 && currentIndex < jsonData.length ? jsonData[currentIndex] : null;
    const currentDocTokens = currentDoc ? countTokens(currentDoc.text) : 0;

    useEffect(() => {
        // AUTO-RUNNER: If autoComplete is ON, and we have a current doc, and no chunks yet, RUN IT automatically
        if (autoComplete && currentDoc && !currentDocChunks && !isProcessing) {
            runChunkingForCurrent();
        }
    }, [autoComplete, currentIndex, currentDocChunks, isProcessing, currentDoc]);

    useEffect(() => {
        // AUTO-SAVER: If autoComplete is ON, and we HAVE chunks, ACCEPT automatically
        if (autoComplete && currentDocChunks && !isProcessing) {
            // Small delay to visualize steps if desired, or instant
            const timer = setTimeout(() => {
                handleNext();
            }, 500);
            return () => clearTimeout(timer);
        }
    }, [autoComplete, currentDocChunks, isProcessing]);


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
                    setCurrentIndex(-1);
                    setProcessedChunks([]);
                } catch (error) {
                    alert("Invalid JSON file");
                }
            };
            reader.readAsText(uploadedFile);
        }
    };

    const startSession = () => {
        if (!config.apiKey) {
            alert("Please enter an OpenRouter API Key.");
            return;
        }
        setCurrentIndex(0);
    };

    const runChunkingForCurrent = async () => {
        if (!currentDoc) return;
        setIsProcessing(true);
        setCurrentDocChunks(null); // Clear previous runs for this doc

        try {
            // 1. CHUNK
            const rawChunks = await chunkWithOpenRouter(currentDoc.text, currentDoc.title, config.apiKey, config.modelName);

            // 2. PROCESS
            const finalChunks = postProcessChunks(rawChunks, currentDoc.text, {
                title: currentDoc.title,
                file: currentDoc.file,
                url: currentDoc.url
            });

            setCurrentDocChunks(finalChunks);

        } catch (e) {
            console.error("Chunking failed", e);
            alert("Chunking failed for this item.");
        } finally {
            setIsProcessing(false);
        }
    };

    const handleNext = () => {
        if (currentDocChunks) {
            // Add current doc chunks to master list
            // We can adjust indices here if we want global continuity, but keeping local is fine too.
            // Let's ensure global unique IDs or something if needed.
            setProcessedChunks(prev => [...prev, ...currentDocChunks]);
            setCurrentDocChunks(null); // reset for next
        }

        // Move index
        if (currentIndex < jsonData.length - 1) {
            setCurrentIndex(curr => curr + 1);
        } else {
            // Done
            alert("All documents processed!");
            setAutoComplete(false);
            setCurrentIndex(jsonData.length); // End state
        }
    };

    const handleRerun = () => {
        // Just run it again
        runChunkingForCurrent();
    };

    const toggleAuto = () => {
        setAutoComplete(!autoComplete);
    };

    const downloadJson = () => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(processedChunks, null, 2));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", `manual_rag_chunks.json`);
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
    };

    // --- RENDER HELPERS ---

    if (!file || currentIndex === -1) {
        return (
            <div className="max-w-4xl mx-auto p-6 space-y-6">
                <header className="flex items-center gap-3 mb-8">
                    <Brain className="text-purple-600" size={32} />
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900">Manual AI Laboratory</h1>
                        <p className="text-slate-500">Supervised AI chunking with step-by-step verification.</p>
                    </div>
                </header>

                <Card className="p-8">
                    <h2 className="text-lg font-semibold mb-6 flex items-center gap-2">
                        <Settings size={20} className="text-slate-400" />
                        Session Setup
                    </h2>

                    <div className="space-y-6 max-w-lg">
                        {/* API Key */}
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">
                                OpenRouter API Key <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="password"
                                value={config.apiKey}
                                onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
                                className="w-full border border-slate-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-purple-500 outline-none"
                                placeholder="sk-or-..."
                            />
                        </div>

                        {/* Model Name */}
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">
                                Model Name
                            </label>
                            <input
                                type="text"
                                value={config.modelName}
                                onChange={(e) => setConfig({ ...config, modelName: e.target.value })}
                                className="w-full border border-slate-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-purple-500 outline-none font-mono text-sm"
                                placeholder="e.g., xiaomi/mimo-v2-flash:free"
                            />
                            <p className="text-xs text-slate-400 mt-1">
                                Try <code className="bg-slate-100 px-1 rounded">google/gemini-2.0-flash-exp:free</code> or <code className="bg-slate-100 px-1 rounded">xiaomi/mimo-v2-flash:free</code>
                            </p>
                        </div>

                        {/* File Upload */}
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Source JSON File</label>
                            <div className="border-2 border-dashed border-slate-200 rounded-lg p-6 text-center hover:bg-slate-50 relative cursor-pointer group">
                                <input
                                    type="file"
                                    accept=".json"
                                    onChange={handleFileUpload}
                                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
                                />
                                {file ? (
                                    <div className="flex flex-col items-center text-emerald-600">
                                        <Check size={32} className="mb-2" />
                                        <span className="font-semibold">{file.name}</span>
                                        <span className="text-xs text-emerald-500">{jsonData.length} documents found</span>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center text-slate-400 group-hover:text-slate-600">
                                        <Upload size={32} className="mb-2" />
                                        <span>Click to upload JSON</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        <Button
                            onClick={startSession}
                            disabled={!file || !config.apiKey}
                            className="w-full justify-center"
                            variant="primary"
                            icon={Play}
                            size="lg"
                        >
                            Start Manual Session
                        </Button>
                    </div>
                </Card>
            </div>
        );
    }

    // --- REVIEW MODE ---

    const isDone = currentIndex >= jsonData.length;

    return (
        <div className="min-h-screen bg-slate-100 p-4 pb-20">

            {/* Top Bar */}
            <div className="fixed top-0 left-0 right-0 bg-white shadow-sm z-50 px-6 py-3 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className="bg-purple-100 text-purple-700 px-3 py-1 rounded font-bold font-mono">
                        Manual Mode
                    </div>
                    <div className="h-6 w-px bg-slate-200"></div>
                    <div className="flex flex-col">
                        <span className="text-xs text-slate-500 uppercase tracking-wide">Progress</span>
                        <span className="font-bold text-slate-800">{Math.min(currentIndex + 1, jsonData.length)} / {jsonData.length}</span>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {isDone ? (
                        <Button onClick={downloadJson} variant="success" icon={Download}>
                            Download Final JSON ({processedChunks.length} chunks)
                        </Button>
                    ) : (
                        <>
                            <Button onClick={toggleAuto} variant={autoComplete ? "danger" : "secondary"} icon={autoComplete ? StopCircle : FastForward}>
                                {autoComplete ? "Stop Auto" : "Switch to Auto"}
                            </Button>
                            <div className="text-xs font-mono text-slate-400 bg-slate-50 px-2 py-1 rounded border">
                                Total Chunks: {processedChunks.length}
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Token Comparison Stats Bar */}
            {currentDocChunks && (
                <div className="max-w-[1600px] mx-auto mt-20 mb-4">
                    <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl p-4 shadow-lg">
                        <div className="grid grid-cols-4 gap-6 text-white">
                            <div className="text-center">
                                <div className="text-2xl font-bold">{currentDocTokens.toLocaleString()}</div>
                                <div className="text-xs text-blue-100 uppercase tracking-wide">Input Tokens</div>
                            </div>
                            <div className="text-center border-l border-white/20">
                                <div className="text-2xl font-bold">{currentDocChunks.length}</div>
                                <div className="text-xs text-purple-100 uppercase tracking-wide">Output Chunks</div>
                            </div>
                            <div className="text-center border-l border-white/20">
                                <div className="text-2xl font-bold">{currentDocChunks.reduce((sum, c) => sum + c.chunk_tokens, 0).toLocaleString()}</div>
                                <div className="text-xs text-purple-100 uppercase tracking-wide">Output Tokens</div>
                            </div>
                            <div className="text-center border-l border-white/20">
                                <div className="text-2xl font-bold">
                                    {((currentDocChunks.reduce((sum, c) => sum + c.chunk_tokens, 0) / currentDocTokens) * 100).toFixed(0)}%
                                </div>
                                <div className="text-xs text-purple-100 uppercase tracking-wide">Token Retention</div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div className={`max-w-[1600px] mx-auto ${currentDocChunks ? '' : 'mt-20'} grid grid-cols-2 gap-6 h-[calc(100vh-${currentDocChunks ? '200px' : '120px'})]`}>

                {/* LEFT: SOURCE */}
                <Card className="flex flex-col h-full border-blue-200 bg-blue-50/30">
                    <div className="p-4 border-b border-blue-100 bg-blue-50 flex justify-between items-center">
                        <h3 className="font-bold text-blue-900 flex items-center gap-2">
                            <FileText size={18} />
                            Source Document
                        </h3>
                        {currentDoc && (
                            <span className={`px-2 py-1 rounded text-xs font-bold ${currentDocTokens > 1000 ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                                {currentDocTokens} Tokens
                            </span>
                        )}
                    </div>
                    <div className="flex-1 overflow-auto p-6 font-mono text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">
                        {isDone ? (
                            <div className="flex flex-col items-center justify-center h-full text-slate-400 opacity-50">
                                <Check size={64} className="mb-4" />
                                <p className="text-xl">All Done</p>
                            </div>
                        ) : (
                            <>
                                <div className="mb-4 font-bold text-lg text-black">{currentDoc.title}</div>
                                {currentDoc.text}
                            </>
                        )}
                    </div>
                </Card>

                {/* RIGHT: AI OUTPUT */}
                <Card className="flex flex-col h-full border-purple-200 bg-white">
                    <div className="p-4 border-b border-purple-100 bg-purple-50 flex justify-between items-center">
                        <h3 className="font-bold text-purple-900 flex items-center gap-2">
                            <Brain size={18} />
                            AI Generation
                        </h3>
                        {currentDocChunks && (
                            <span className="px-2 py-1 rounded text-xs font-bold bg-purple-100 text-purple-700">
                                {currentDocChunks.length} Chunks Generated
                            </span>
                        )}
                    </div>

                    <div className="flex-1 overflow-auto p-4 bg-slate-50 relative">

                        {isProcessing && (
                            <div className="absolute inset-0 bg-white/80 z-10 flex flex-col items-center justify-center">
                                <RefreshCw className="animate-spin text-purple-600 mb-2" size={48} />
                                <p className="text-purple-900 font-medium">AI is thinking...</p>
                            </div>
                        )}

                        {!currentDocChunks && !isDone && !isProcessing && (
                            <div className="h-full flex flex-col items-center justify-center">
                                <Button onClick={runChunkingForCurrent} size="lg" icon={Zap} className="shadow-xl">
                                    Generate Chunks for Doc #{currentIndex + 1}
                                </Button>
                                <p className="mt-4 text-slate-400 text-sm">Review tokens on the left before running.</p>
                            </div>
                        )}

                        {currentDocChunks && (
                            <div className="space-y-4 pb-20">
                                {currentDocChunks.map((chunk, i) => (
                                    <div key={i} className="bg-white p-4 rounded border border-purple-100 shadow-sm hover:border-purple-300">
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="text-[10px] uppercase font-bold bg-slate-100 px-2 py-0.5 rounded text-slate-600">{chunk.chunk_type}</span>
                                            <span className="text-sm font-semibold text-purple-900">{chunk.title}</span>
                                        </div>
                                        <p className="text-xs text-slate-600 font-mono mb-2">{chunk.content.text}</p>
                                        <div className="flex gap-1">
                                            {chunk.tags.programs.map(p => <span key={p} className="text-[9px] bg-blue-50 text-blue-600 px-1 border border-blue-100 rounded">{p}</span>)}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* ACTION BAR */}
                    {!isDone && (
                        <div className="p-4 border-t border-slate-200 bg-white flex items-center justify-between gap-4">
                            <Button onClick={handleRerun} disabled={isProcessing || !currentDocChunks} variant="secondary" icon={RotateCcw}>
                                Rerun
                            </Button>

                            <div className="flex-1"></div>

                            <Button
                                onClick={handleNext}
                                disabled={isProcessing || !currentDocChunks}
                                variant="primary"
                                icon={ArrowRight}
                                className="w-48"
                            >
                                {autoComplete ? "Auto-Completing..." : "Accept & Next"}
                            </Button>
                        </div>
                    )}
                </Card>

            </div>
        </div>
    );
}

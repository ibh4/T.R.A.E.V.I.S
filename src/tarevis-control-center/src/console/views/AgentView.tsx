import {
  Bot,
  ChevronLeft,
  ChevronRight,
  FileCode2,
  Folder,
  FolderOpen,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { TechPanel } from "../../components/StatusPrimitives";
import { renderMarkdown } from "../../control/markdown";
import {
  harnessClient,
  type DirectoryListing,
  type FileContent,
  type HarnessChatMessage,
  type HarnessProject,
  type HarnessStatus,
  type HarnessToolTrace,
} from "../../harness/client";

interface ConversationMessage extends HarnessChatMessage {
  id: string;
  toolCalls?: HarnessToolTrace[];
  model?: string;
}

type ProjectDialog = "create" | "edit" | "delete" | null;

export function AgentView() {
  const [status, setStatus] = useState<HarnessStatus | null>(null);
  const [projects, setProjects] = useState<HarnessProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [selectedFile, setSelectedFile] = useState<FileContent | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [browserLoading, setBrowserLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectDialog, setProjectDialog] = useState<ProjectDialog>(null);
  const [projectName, setProjectName] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [savingProject, setSavingProject] = useState(false);
  const messageEndRef = useRef<HTMLDivElement | null>(null);

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;

  useEffect(() => {
    void loadWorkspace();
  }, []);

  useEffect(() => {
    if (!selectedProjectId) {
      setListing(null);
      setSelectedFile(null);
      return;
    }
    setMessages([]);
    void openDirectory(".");
  }, [selectedProjectId]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages, sending]);

  async function loadWorkspace(preferredProjectId?: string) {
    setLoading(true);
    setError(null);
    try {
      const [nextStatus, nextProjects] = await Promise.all([
        harnessClient.getStatus(),
        harnessClient.listProjects(),
      ]);
      setStatus(nextStatus);
      setProjects(nextProjects);
      setSelectedProjectId((current) => {
        const preferred = preferredProjectId ?? current;
        return nextProjects.some((project) => project.id === preferred)
          ? preferred
          : nextProjects[0]?.id ?? "";
      });
    } catch (nextError) {
      setError(errorMessage(nextError, "无法连接 Harness 后端。"));
    } finally {
      setLoading(false);
    }
  }

  async function openDirectory(path: string) {
    if (!selectedProjectId) return;
    setBrowserLoading(true);
    setError(null);
    try {
      const nextListing = await harnessClient.listDirectory(selectedProjectId, path);
      setListing(nextListing);
      setSelectedFile(null);
    } catch (nextError) {
      setError(errorMessage(nextError, "目录读取失败。"));
    } finally {
      setBrowserLoading(false);
    }
  }

  async function openFile(path: string) {
    if (!selectedProjectId) return;
    setBrowserLoading(true);
    setError(null);
    try {
      setSelectedFile(await harnessClient.readFile(selectedProjectId, path));
    } catch (nextError) {
      setError(errorMessage(nextError, "文件读取失败。"));
    } finally {
      setBrowserLoading(false);
    }
  }

  function openProjectDialog(mode: Exclude<ProjectDialog, null>) {
    if (mode !== "create" && !selectedProject) return;
    setProjectName(mode === "create" ? "" : selectedProject?.name ?? "");
    setProjectPath(mode === "create" ? "" : selectedProject?.path ?? "");
    setProjectDialog(mode);
    setError(null);
  }

  async function saveProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectDialog || projectDialog === "delete" || savingProject) return;
    setSavingProject(true);
    setError(null);
    try {
      const project = projectDialog === "create"
        ? await harnessClient.createProject({ name: projectName, path: projectPath })
        : await harnessClient.updateProject(selectedProjectId, { name: projectName, path: projectPath });
      setProjectDialog(null);
      await loadWorkspace(project.id);
    } catch (nextError) {
      setError(errorMessage(nextError, "项目保存失败。"));
    } finally {
      setSavingProject(false);
    }
  }

  async function deleteProject() {
    if (!selectedProject || savingProject) return;
    setSavingProject(true);
    setError(null);
    try {
      await harnessClient.deleteProject(selectedProject.id);
      setProjectDialog(null);
      await loadWorkspace();
    } catch (nextError) {
      setError(errorMessage(nextError, "项目删除失败。"));
    } finally {
      setSavingProject(false);
    }
  }

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = input.trim();
    if (!content || !selectedProject || !status?.configured || sending) return;
    const userMessage: ConversationMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
    };
    const history = messages.map(({ role, content: historyContent }) => ({ role, content: historyContent }));
    setMessages((current) => [...current, userMessage]);
    setInput("");
    setSending(true);
    setError(null);
    try {
      const result = await harnessClient.chat({
        projectId: selectedProject.id,
        message: content,
        history,
      });
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: result.reply,
        toolCalls: result.toolCalls,
        model: result.model,
      }]);
    } catch (nextError) {
      setError(errorMessage(nextError, "Agent 请求失败。"));
    } finally {
      setSending(false);
    }
  }

  const breadcrumbs = useMemo(() => buildBreadcrumbs(listing?.path ?? "."), [listing?.path]);
  const canChat = Boolean(selectedProject && status?.configured && !sending);

  return (
    <div className="agent-view">
      <div className="view-heading">
        <div>
          <span>PROJECT HARNESS / 项目代理</span>
          <h1>Agent 工作台</h1>
        </div>
        <div className={`agent-provider-state ${status?.configured ? "is-ready" : "is-unconfigured"}`}>
          {status?.configured ? <ShieldCheck size={18} /> : <KeyRound size={18} />}
          <span>{status?.configured ? `${status.model} READY` : "QWEN KEY REQUIRED"}</span>
        </div>
      </div>

      {error && <div className="action-error agent-action-error" role="alert">{error}</div>}

      <div className="agent-workspace">
        <TechPanel className="agent-project-panel">
          <div className="panel-heading">
            <div><span>PROJECT ROOTS</span><strong>项目列表</strong></div>
            <div className="agent-panel-actions">
              <button className="icon-button" type="button" title="新增项目" aria-label="新增项目" onClick={() => openProjectDialog("create")}>
                <Plus size={16} />
              </button>
              <button className="icon-button" type="button" title="刷新项目" aria-label="刷新项目" disabled={loading} onClick={() => void loadWorkspace()}>
                <RefreshCw size={16} />
              </button>
            </div>
          </div>
          <div className="agent-project-list" aria-label="Harness 项目列表">
            {projects.map((project) => (
              <button
                key={project.id}
                type="button"
                className={project.id === selectedProjectId ? "is-selected" : ""}
                onClick={() => setSelectedProjectId(project.id)}
              >
                <FolderOpen size={17} />
                <span><strong>{project.name}</strong><small title={project.path}>{project.path}</small></span>
                <ChevronRight size={15} />
              </button>
            ))}
            {!loading && projects.length === 0 && <p className="empty-state">暂无项目。</p>}
          </div>
          {selectedProject && (
            <div className="agent-project-actions">
              <button className="button button--quiet" type="button" onClick={() => openProjectDialog("edit")}>
                <Pencil size={15} /> 编辑
              </button>
              <button className="button button--danger" type="button" onClick={() => openProjectDialog("delete")}>
                <Trash2 size={15} /> 删除
              </button>
            </div>
          )}
        </TechPanel>

        <TechPanel className="agent-browser-panel">
          <div className="panel-heading">
            <div>
              <span>{selectedFile ? "FILE PREVIEW" : "PROJECT BROWSER"}</span>
              <strong>{selectedFile?.path ?? selectedProject?.name ?? "未选择项目"}</strong>
            </div>
            <button
              className="icon-button"
              type="button"
              title={selectedFile ? "返回目录" : "刷新目录"}
              aria-label={selectedFile ? "返回目录" : "刷新目录"}
              disabled={!selectedProject || browserLoading}
              onClick={() => selectedFile ? setSelectedFile(null) : void openDirectory(listing?.path ?? ".")}
            >
              {selectedFile ? <ChevronLeft size={17} /> : <RefreshCw size={16} />}
            </button>
          </div>

          {!selectedFile && selectedProject && (
            <div className="agent-breadcrumbs" aria-label="当前目录">
              {breadcrumbs.map((crumb, index) => (
                <span key={crumb.path}>
                  {index > 0 && <ChevronRight size={12} />}
                  <button type="button" onClick={() => void openDirectory(crumb.path)}>{crumb.label}</button>
                </span>
              ))}
            </div>
          )}

          <div className="agent-browser-content" aria-busy={browserLoading}>
            {browserLoading && <div className="agent-loading"><RefreshCw size={20} /> READING</div>}
            {!browserLoading && !selectedProject && <p className="empty-state">暂无项目。</p>}
            {!browserLoading && selectedProject && selectedFile && <FilePreview file={selectedFile} />}
            {!browserLoading && selectedProject && !selectedFile && (
              <div className="agent-file-list">
                {listing?.entries.map((entry) => (
                  <button
                    key={entry.path}
                    type="button"
                    onClick={() => entry.type === "directory" ? void openDirectory(entry.path) : void openFile(entry.path)}
                  >
                    {entry.type === "directory" ? <Folder size={17} /> : <FileCode2 size={17} />}
                    <span>{entry.name}</span>
                    <small>{entry.type === "directory" ? "DIR" : formatBytes(entry.size ?? 0)}</small>
                    <ChevronRight size={14} />
                  </button>
                ))}
                {listing && listing.entries.length === 0 && <p className="empty-state">目录为空。</p>}
              </div>
            )}
          </div>
          {listing?.truncated && !selectedFile && <span className="agent-truncated">仅显示前 300 项</span>}
        </TechPanel>

        <TechPanel className="agent-chat-panel">
          <div className="panel-heading">
            <div><span>QWEN AGENT</span><strong>{selectedProject?.name ?? "未选择项目"}</strong></div>
            <Bot size={19} />
          </div>
          <div className="agent-conversation" aria-live="polite">
            {messages.length === 0 && (
              <div className="agent-empty-conversation">
                <Bot size={28} />
                <strong>尚无会话</strong>
                <span>{status?.configured ? status.model : "模型凭据未配置"}</span>
              </div>
            )}
            {messages.map((message) => (
              <article className={`agent-message agent-message--${message.role}`} key={message.id}>
                <header><span>{message.role === "user" ? "YOU" : message.model?.toUpperCase() ?? "AGENT"}</span></header>
                <div className="agent-message__content" dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }} />
                {message.toolCalls && message.toolCalls.length > 0 && (
                  <div className="agent-tool-traces">
                    {message.toolCalls.map((trace, index) => (
                      <div className={trace.ok ? "is-success" : "is-error"} key={`${message.id}-${index}`}>
                        <span>{trace.tool}</span><strong>{trace.summary}</strong>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            ))}
            {sending && <div className="agent-thinking"><i /><i /><i /><span>AGENT RUNNING</span></div>}
            <div ref={messageEndRef} />
          </div>
          <form className="agent-prompt-form" onSubmit={submitMessage}>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={status?.configured ? "询问当前项目..." : "等待后端配置模型凭据"}
              aria-label="Agent 消息"
              rows={3}
              maxLength={8_000}
              disabled={!selectedProject || !status?.configured || sending}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <div>
              <span><ShieldCheck size={13} /> READ ONLY</span>
              <button className="icon-button" type="submit" title="发送消息" aria-label="发送 Agent 消息" disabled={!canChat || !input.trim()}>
                <Send size={17} />
              </button>
            </div>
          </form>
        </TechPanel>
      </div>

      {projectDialog && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => !savingProject && setProjectDialog(null)}>
          <section className="confirm-modal project-dialog" role="dialog" aria-modal="true" aria-labelledby="project-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="icon-button confirm-modal__close" type="button" title="关闭" aria-label="关闭项目设置" onClick={() => setProjectDialog(null)} disabled={savingProject}>
              <X size={18} />
            </button>
            {projectDialog === "delete" ? <Trash2 size={30} /> : <FolderOpen size={30} />}
            <span>HARNESS PROJECT</span>
            <h2 id="project-dialog-title">{projectDialog === "create" ? "新增项目" : projectDialog === "edit" ? "编辑项目" : "删除项目"}</h2>
            {projectDialog === "delete" ? (
              <>
                <p>从列表移除“{selectedProject?.name}”。项目文件不会被删除。</p>
                <div className="confirm-modal__actions">
                  <button className="button button--quiet" type="button" onClick={() => setProjectDialog(null)} disabled={savingProject}>取消</button>
                  <button className="button button--danger" type="button" onClick={() => void deleteProject()} disabled={savingProject}>
                    {savingProject ? "处理中..." : "确认移除"}
                  </button>
                </div>
              </>
            ) : (
              <form className="project-dialog__form" onSubmit={saveProject}>
                <label><span>项目名称</span><input value={projectName} onChange={(event) => setProjectName(event.target.value)} maxLength={80} autoFocus /></label>
                <label><span>项目路径</span><input value={projectPath} onChange={(event) => setProjectPath(event.target.value)} maxLength={1_024} /></label>
                <div className="confirm-modal__actions">
                  <button className="button button--quiet" type="button" onClick={() => setProjectDialog(null)} disabled={savingProject}>取消</button>
                  <button className="button button--primary" type="submit" disabled={savingProject || !projectName.trim() || !projectPath.trim()}>
                    <Save size={15} /> {savingProject ? "保存中..." : "保存"}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function FilePreview({ file }: { file: FileContent }) {
  const lines = file.content.split("\n");
  return (
    <div className="agent-file-preview">
      <div className="agent-file-meta">
        <span>{file.totalLines} LINES</span><span>{formatBytes(file.size)}</span>
      </div>
      <pre>{lines.map((line, index) => (
        <span key={`${file.path}-${index}`}><i>{file.startLine + index}</i><code>{line || " "}</code></span>
      ))}</pre>
    </div>
  );
}

function buildBreadcrumbs(path: string): Array<{ label: string; path: string }> {
  if (path === ".") return [{ label: "ROOT", path: "." }];
  const segments = path.split("/").filter(Boolean);
  return [
    { label: "ROOT", path: "." },
    ...segments.map((segment, index) => ({
      label: segment,
      path: segments.slice(0, index + 1).join("/"),
    })),
  ];
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

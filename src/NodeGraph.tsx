import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  MarkerType,
  ConnectionMode,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
  type ReactFlowInstance,
} from "reactflow";

import "reactflow/dist/style.css";
import "./NodeGraph.css";

/** ---------------- Types ---------------- */

type ResourceItem = {
  name: string;
  color: string; // hex
};

type CustomNodeData = {
  label: string;
  params: Record<string, any>;
  archetype?: string;

  onDelete?: (id: string) => void;
  onParamChange?: (id: string, key: string, value: any) => void;

  onLabelChange?: (id: string, newLabel: string) => void;
  onArchetypeChange?: (id: string, archetype: string) => void;

  resourceOptions?: ResourceItem[];
  requestResources?: () => Promise<ResourceItem[]>;
  getResourceColor?: (name: string) => string;
};

type BackendNode = {
  uid: string;
  name?: string;
  data: {
    archetype: string;
    connections?: any;

    name?: string;

    x?: number;
    y?: number;

    rolled?: boolean;

    in_flow?: number;
    out_flow?: number;
    capacity?: number;
    stored?: number;
    enabled?: boolean;

    in_resource?: string;
    out_resource?: string;
    in_per_out?: number;

    [key: string]: any;
  };
};

type BackendConnection = {
  uid: string;
  parent: string;
  child: string;
  parent_dir: "up" | "down" | "left" | "right";
  child_dir: "up" | "down" | "left" | "right";
  resource?: string;
  planned_flow?: number;
  actual_flow?: number;
  flow_multiplier?: number;
};

/** ---------------- Utils ---------------- */

const API_BASE = "http://127.0.0.1:8502";
const SESSION_STORAGE_KEY = "node_world_session_id";

const generateUid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? (crypto as any).randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function formatKey(key: string) {
  return key.replace(/_/g, " ");
}

function formatValue(value: any) {
  if (typeof value === "number") {
    if (Number.isInteger(value)) return value.toString();
    return value.toFixed(2);
  }
  if (value == null) return "null";
  if (typeof value === "object") return "[object]";
  return String(value);
}

function mapHandleToDir(handleId?: string | null): string {
  if (!handleId) return "right";
  if (handleId.includes("top")) return "up";
  if (handleId.includes("bottom")) return "down";
  if (handleId.includes("left")) return "left";
  if (handleId.includes("right")) return "right";
  return "right";
}

function dirToSourceHandle(dir: string) {
  switch (dir) {
    case "up":
      return "io-top-source";
    case "down":
      return "io-bottom-source";
    case "left":
      return "io-left-source";
    case "right":
    default:
      return "io-right-source";
  }
}

function dirToTargetHandle(dir: string) {
  switch (dir) {
    case "up":
      return "io-top-target";
    case "down":
      return "io-bottom-target";
    case "left":
      return "io-left-target";
    case "right":
    default:
      return "io-right-target";
  }
}

const NOTHING_RESOURCE: ResourceItem = { name: "nothing", color: "#000000" };

function normalizeResources(payload: any): ResourceItem[] {
  const out: ResourceItem[] = [];

  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    for (const [name, color] of Object.entries(payload)) {
      if (typeof name !== "string") continue;
      const hex = typeof color === "string" ? color : "#000000";
      out.push({ name, color: hex || "#000000" });
    }
  }

  if (Array.isArray(payload)) {
    for (const it of payload) {
      if (!it || typeof it !== "object") continue;

      const name =
        typeof (it as any).name === "string"
          ? (it as any).name
          : typeof (it as any)["название"] === "string"
          ? (it as any)["название"]
          : "";

      const color =
        typeof (it as any).color === "string"
          ? (it as any).color
          : typeof (it as any)["hex цвет"] === "string"
          ? (it as any)["hex цвет"]
          : "";

      if (!name) continue;
      out.push({ name, color: color || "#000000" });
    }
  }

  const hasNothing = out.some((r) => r.name === NOTHING_RESOURCE.name);
  if (!hasNothing) out.unshift(NOTHING_RESOURCE);
  else {
    const filtered = out.filter((r) => r.name !== "nothing");
    out.length = 0;
    out.push(NOTHING_RESOURCE, ...filtered);
  }

  return out;
}

/** ---------------- Archetypes ---------------- */

const ARCHETYPES = [
  "генератор",
  "хранилище",
  "потребитель",
  "преобразователь",
  "объединитель",
  "разделитель",
] as const;

/** ---------------- Collapsed gears (SVG) ---------------- */

const GearTeeth: React.FC<{ r: number; teeth?: number; toothW?: number; toothH?: number }> = ({
  r,
  teeth = 10,
  toothW = 5,
  toothH = 7,
}) => {
  const items = Array.from({ length: teeth });
  return (
    <>
      <circle cx="0" cy="0" r={r} />
      {items.map((_, i) => {
        const a = (i * 360) / teeth;
        return (
          <rect
            key={i}
            x={-toothW / 2}
            y={-(r + toothH)}
            width={toothW}
            height={toothH}
            rx={1}
            ry={1}
            transform={`rotate(${a})`}
          />
        );
      })}
      <circle cx="0" cy="0" r={Math.max(2, r * 0.35)} />
    </>
  );
};

const DefaultGears: React.FC = () => {
  return (
    <div className="rolled-gears">
      <svg viewBox="-60 -40 120 80" width="120" height="70" role="img" aria-label="gears" className="rolled-gears-svg">
        <g className="gear gear-a" transform="translate(-15,0)">
          <GearTeeth r={18} teeth={12} toothW={5} toothH={7} />
        </g>
        <g className="gear gear-b" transform="translate(18,5)">
          <GearTeeth r={14} teeth={10} toothW={4.5} toothH={6} />
        </g>
        <g className="gear gear-c" transform="translate(40,-10)">
          <GearTeeth r={9} teeth={9} toothW={4} toothH={5} />
        </g>
      </svg>
    </div>
  );
};

/** ---------------- Node UI ---------------- */

const CustomNode: React.FC<NodeProps<CustomNodeData>> = ({ id, data }) => {
  const isUltimate = data.archetype === "ultimate" || data.label === "Ультимейт";
  const rolled = !!data.params?.rolled;

  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(data.label);

  useEffect(() => {
    if (!isEditingLabel) setLabelDraft(data.label);
  }, [data.label, isEditingLabel]);

  const commitLabel = () => {
    const next = labelDraft.trim();
    setIsEditingLabel(false);
    if (!next) {
      setLabelDraft(data.label);
      return;
    }
    if (next !== data.label) data.onLabelChange?.(id, next);
  };

  const [archOpen, setArchOpen] = useState(false);

  const [resourcePicker, setResourcePicker] = useState<"in" | "out" | null>(null);
  const [resourceLoading, setResourceLoading] = useState(false);
  const [resourceErr, setResourceErr] = useState<string | null>(null);
  const [localResources, setLocalResources] = useState<ResourceItem[]>(data.resourceOptions ?? [NOTHING_RESOURCE]);

  useEffect(() => {
    if (Array.isArray(data.resourceOptions) && data.resourceOptions.length > 0) {
      setLocalResources(data.resourceOptions);
    }
  }, [data.resourceOptions]);

  const entries = useMemo(() => Object.entries(data.params), [data.params]);

  const inRes: string = typeof data.params?.in_resource === "string" ? data.params.in_resource : "nothing";
  const outRes: string = typeof data.params?.out_resource === "string" ? data.params.out_resource : "nothing";

  const getColor = useCallback(
    (name: string) => {
      if (name === "nothing") return "#000000";
      return data.getResourceColor ? data.getResourceColor(name) : "#000000";
    },
    [data]
  );

  const openResourcePicker = async (side: "in" | "out") => {
    setResourcePicker(side);
    setResourceErr(null);
    setResourceLoading(true);

    try {
      const list = data.requestResources ? await data.requestResources() : [NOTHING_RESOURCE];
      setLocalResources(list && list.length ? list : [NOTHING_RESOURCE]);
    } catch (e) {
      console.error("Failed to request resources", e);
      setResourceErr("Не удалось загрузить ресурсы");
      setLocalResources([NOTHING_RESOURCE]);
    } finally {
      setResourceLoading(false);
    }
  };

  const pickResource = (side: "in" | "out", name: string) => {
    if (!data.onParamChange) return;
    const key = side === "in" ? "in_resource" : "out_resource";
    data.onParamChange(id, key, name || "nothing");
    setResourcePicker(null);
  };

  const handleNumberChange = (key: string, raw: string) => {
    if (!data.onParamChange) return;
    const num = Number(raw);
    if (Number.isNaN(num)) return;
    data.onParamChange(id, key, num);
  };

  const handleBoolToggle = (key: string, current: boolean) => {
    if (!data.onParamChange) return;
    data.onParamChange(id, key, !current);
  };

  const toggleRolled = () => {
    if (!data.onParamChange) return;
    data.onParamChange(id, "rolled", !rolled);
  };

  const hiddenKeys = useMemo(
    () =>
      new Set([
        "uid",
        "connections",
        "in_resource",
        "out_resource",
        "archetype",
        "name",
        "x",
        "y",
        "rolled",
      ]),
    []
  );

  const visibleEntries = useMemo(() => entries.filter(([k]) => !hiddenKeys.has(k)), [entries, hiddenKeys]);

  return (
    <div className={"custom-node" + (rolled ? " custom-node-rolled" : "")}>
      <style>{`
        .custom-node.custom-node-rolled { width: 170px; min-width: 170px; }
        .custom-node.custom-node-rolled .custom-node-body { padding: 8px 10px 10px; }
        .custom-node.custom-node-rolled .custom-node-values { padding-top: 6px; }
        .custom-node.custom-node-rolled .custom-node-table,
        .custom-node.custom-node-rolled .node-arch-row,
        .custom-node.custom-node-rolled .node-resource-row,
        .custom-node.custom-node-rolled .node-resource-picker { display: none !important; }
        .custom-node.custom-node-rolled .custom-node-label {
          max-width: 105px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          display: inline-block; vertical-align: middle;
        }
        .custom-node-header .custom-node-roll {
          margin-left: 0px; width: 26px; height: 26px; border-radius: 8px;
          border: 1px solid rgba(255,255,255,0.16);
          background: rgba(255,255,255,0.06);
          color: rgba(255,255,255,0.92);
          cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
          line-height: 1; user-select: none;
        }
        .custom-node-header .custom-node-roll:hover { background: rgba(255,255,255,0.10); }

        .rolled-gears { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:6px 0 2px; }
        .rolled-gears-svg { opacity:0.95; filter: drop-shadow(0 2px 6px rgba(0,0,0,0.35)); }

        .gear { fill: rgba(255,255,255,0.10); stroke: rgba(255,255,255,0.55); stroke-width:1.4; transform-box: fill-box; transform-origin:center; }
        @keyframes gearSpinCW { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes gearSpinCCW { from { transform: rotate(0deg); } to { transform: rotate(-360deg); } }
        .gear-a { animation: gearSpinCW 2.6s linear infinite; }
        .gear-b { animation: gearSpinCCW 2.1s linear infinite; }
        .gear-c { animation: gearSpinCW 1.7s linear infinite; }
      `}</style>

      <div className="custom-node-header">
        <div className="custom-node-label-wrap">
          {!isEditingLabel ? (
            <span
              className="custom-node-label editable"
              title="Двойной клик — переименовать (обновит name на бэке)"
              onDoubleClick={() => setIsEditingLabel(true)}
            >
              {data.label}
            </span>
          ) : (
            <input
              className="custom-node-label-input"
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
              onBlur={commitLabel}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitLabel();
                if (e.key === "Escape") {
                  setIsEditingLabel(false);
                  setLabelDraft(data.label);
                }
              }}
              autoFocus
            />
          )}
        </div>

        <div className="custom-node-actions">
          <button
            className="custom-node-roll"
            onClick={toggleRolled}
            title={rolled ? "Развернуть" : "Свернуть"}
            aria-label={rolled ? "unroll node" : "roll node"}
          >
            {rolled ? "▢" : "—"}
          </button>

          <button className="custom-node-delete" onClick={() => data.onDelete?.(id)} title="Удалить ноду">
            ×
          </button>
        </div>
      </div>

      <div className="custom-node-body">
        <Handle id="io-top-target" type="target" position={Position.Top} className="custom-handle custom-handle-top custom-handle-hitbox" />
        <Handle id="io-top-source" type="source" position={Position.Top} className="custom-handle custom-handle-top custom-handle-visible" />

        <Handle id="io-bottom-target" type="target" position={Position.Bottom} className="custom-handle custom-handle-bottom custom-handle-hitbox" />
        <Handle id="io-bottom-source" type="source" position={Position.Bottom} className="custom-handle custom-handle-bottom custom-handle-visible" />

        <Handle id="io-left-target" type="target" position={Position.Left} className="custom-handle custom-handle-left custom-handle-hitbox" />
        <Handle id="io-left-source" type="source" position={Position.Left} className="custom-handle custom-handle-left custom-handle-visible" />

        <Handle id="io-right-target" type="target" position={Position.Right} className="custom-handle custom-handle-right custom-handle-hitbox" />
        <Handle id="io-right-source" type="source" position={Position.Right} className="custom-handle custom-handle-right custom-handle-visible" />

        <div className="custom-node-values">
          {rolled ? (
            <DefaultGears />
          ) : (
            <>
              <div className="node-arch-row">
                <div className="node-arch-label">архетип</div>
                <div className="node-arch-box">
                  <button
                    className={"node-arch-pill" + (archOpen ? " open" : "")}
                    onClick={() => setArchOpen((v) => !v)}
                    title="Выбрать архетип (бэк изменит параметры ноды)"
                  >
                    выбрать
                    <span className="node-arch-caret">▾</span>
                  </button>

                  {archOpen && (
                    <div className="node-arch-menu" onMouseLeave={() => setArchOpen(false)}>
                      {ARCHETYPES.map((a) => (
                        <button
                          key={a}
                          className="node-arch-item"
                          onClick={() => {
                            setArchOpen(false);
                            data.onArchetypeChange?.(id, a);
                          }}
                        >
                          {a}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {visibleEntries.length > 0 ? (
                <>
                  <table className="custom-node-table">
                    <thead>
                      <tr>
                        <th>параметр</th>
                        <th>значение</th>
                      </tr>
                    </thead>

                    <tbody>
                      {visibleEntries.map(([key, value]) => {
                        const isBool = typeof value === "boolean";
                        const isNumber = typeof value === "number";

                        if (isUltimate && (isBool || isNumber)) {
                          return (
                            <tr key={key}>
                              <td className="custom-node-table-key">{formatKey(key)}</td>
                              <td className="custom-node-table-value">
                                {isBool ? (
                                  <button
                                    className={
                                      "ultimate-toggle-button" + (value ? " ultimate-toggle-true" : " ultimate-toggle-false")
                                    }
                                    onClick={() => handleBoolToggle(key, value)}
                                  >
                                    {value ? "true" : "false"}
                                  </button>
                                ) : (
                                  <input
                                    type="number"
                                    className="ultimate-number-input"
                                    value={String(value)}
                                    onChange={(e) => handleNumberChange(key, e.target.value)}
                                    inputMode="decimal"
                                  />
                                )}
                              </td>
                            </tr>
                          );
                        }

                        return (
                          <tr key={key}>
                            <td className="custom-node-table-key">{formatKey(key)}</td>
                            <td className="custom-node-table-value">{formatValue(value)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {isUltimate && (
                    <div className="node-resource-row">
                      <div className="node-resource-label">in</div>
                      <button className="node-resource-pill" onClick={() => openResourcePicker("in")}>
                        <span className="node-resource-dot" style={{ backgroundColor: getColor(inRes) }} />
                        <span className="node-resource-name">{inRes}</span>
                      </button>

                      <div className="node-resource-label">out</div>
                      <button className="node-resource-pill" onClick={() => openResourcePicker("out")}>
                        <span className="node-resource-dot" style={{ backgroundColor: getColor(outRes) }} />
                        <span className="node-resource-name">{outRes}</span>
                      </button>
                    </div>
                  )}

                  {isUltimate && resourcePicker && (
                    <div className="node-resource-picker">
                      <div className="node-resource-picker-head">
                        <div className="node-resource-picker-title">
                          {resourcePicker === "in" ? "Выбор входного ресурса" : "Выбор выходного ресурса"}
                        </div>
                        <button className="node-resource-picker-close" onClick={() => setResourcePicker(null)}>
                          ×
                        </button>
                      </div>

                      {resourceLoading && <div className="node-resource-picker-status">Загрузка...</div>}
                      {!resourceLoading && resourceErr && <div className="node-resource-picker-status">{resourceErr}</div>}

                      {!resourceLoading && !resourceErr && (
                        <div className="node-resource-picker-grid">
                          {localResources.map((r) => (
                            <button
                              key={r.name}
                              className="node-resource-picker-item"
                              onClick={() => pickResource(resourcePicker, r.name)}
                            >
                              <span
                                className="node-resource-dot"
                                style={{ backgroundColor: r.name === "nothing" ? "#000000" : r.color }}
                              />
                              <span className="node-resource-name">{r.name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="custom-node-empty">нет параметров</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const nodeTypes = { customNode: CustomNode };

const initialNodes: Node<CustomNodeData>[] = [];
const initialEdges: Edge[] = [];

/** ---------------- Main ---------------- */

export const NodeGraph: React.FC = () => {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<CustomNodeData>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const edgesRef = useRef<Edge[]>([]);
  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  const [resources, setResources] = useState<ResourceItem[]>([NOTHING_RESOURCE]);
  const [newResourceName, setNewResourceName] = useState("");
  const [newResourceColor, setNewResourceColor] = useState("#22c55e");
  const [isResourceModalOpen, setIsResourceModalOpen] = useState(false);

  // Sessions UI
  const [isSessionModalOpen, setIsSessionModalOpen] = useState(false);
  const [sessions, setSessions] = useState<string[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsErr, setSessionsErr] = useState<string | null>(null);

  // ✅ защита от повторных загрузок и гонок
  const loadTokenRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);

  // init session
  useEffect(() => {
    let sid = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!sid) {
      sid = generateUid();
      localStorage.setItem(SESSION_STORAGE_KEY, sid);
    }
    setSessionId(sid);
  }, []);

  const apiFetch = useCallback(
    (path: string, options?: RequestInit) => {
      const hasQuery = path.includes("?");
      const sid = sessionId;

      const url =
        sid != null
          ? `${API_BASE}${path}${hasQuery ? "&" : "?"}session_id=${encodeURIComponent(sid)}`
          : `${API_BASE}${path}`;

      return fetch(url, options);
    },
    [sessionId]
  );

  const apiFetchNoSession = useCallback((path: string, options?: RequestInit) => {
    return fetch(`${API_BASE}${path}`, options);
  }, []);

  const mapBackendNodeToData = useCallback((backend: BackendNode) => {
    const archetype = backend.data.archetype;

    const { archetype: _a, connections: _c, ...rest0 } = backend.data;
    const { x: _x, y: _y, ...rest } = rest0 as any;

    const normalized = {
      rolled: typeof rest.rolled === "boolean" ? rest.rolled : false,
      in_resource: typeof rest.in_resource === "string" ? rest.in_resource : "nothing",
      out_resource: typeof rest.out_resource === "string" ? rest.out_resource : "nothing",
      in_per_out: typeof rest.in_per_out === "number" && Number.isFinite(rest.in_per_out) ? rest.in_per_out : 1,
      ...rest,
    };

    const nameCandidate =
      typeof backend.data?.name === "string" ? backend.data.name : typeof backend.name === "string" ? backend.name : undefined;

    const labelFromApi = typeof nameCandidate === "string" && nameCandidate.trim() ? nameCandidate.trim() : undefined;

    return {
      label: labelFromApi as string | undefined,
      archetype,
      params: { uid: backend.uid, ...normalized },
    };
  }, []);

  // ---------------- Handlers (нужны нодам) ----------------

  const getResourceColor = useCallback(
    (name: string) => {
      if (name === "nothing") return "#000000";
      return resources.find((r) => r.name === name)?.color ?? "#000000";
    },
    [resources]
  );

  const fetchAllResources = useCallback(
    async (signal?: AbortSignal): Promise<ResourceItem[]> => {
      const res = await apiFetch("/resource/all", { method: "GET", signal });
      if (!res.ok) throw new Error("Failed /resource/all");
      const json = await res.json();
      const list = normalizeResources(json);
      setResources(list);
      return list;
    },
    [apiFetch]
  );

  const handleDeleteNode = useCallback(
    (id: string) => {
      const currentEdges = edgesRef.current;
      const edgesToRemove = currentEdges.filter((e) => e.source === id || e.target === id);

      setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
      setNodes((nds) => nds.filter((n) => n.id !== id));

      edgesToRemove.forEach((edge) => {
        const params = new URLSearchParams({ uid: String(edge.id) }).toString();
        apiFetch(`/connection/remove?${params}`, { method: "DELETE" }).catch((err) =>
          console.error("Failed to call /connection/remove", err)
        );
      });

      const params = new URLSearchParams({ uid: String(id) }).toString();
      apiFetch(`/node/remove?${params}`, { method: "DELETE" }).catch((err) => console.error("Failed to call /node/remove", err));
    },
    [apiFetch, setEdges, setNodes]
  );

  const handleLabelChange = useCallback(
    async (id: string, newLabel: string) => {
      const name = newLabel.trim();
      if (!name) return;

      const params = new URLSearchParams({ uid: String(id) }).toString();

      try {
        const res = await apiFetch(`/node/update?${params}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updates: { name } }),
        });

        if (!res.ok) throw new Error("Name update failed");
        const backendNode: BackendNode = await res.json();
        const mapped = mapBackendNodeToData(backendNode);

        setNodes((nds) =>
          nds.map((n) =>
            String(n.id) === String(id)
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    label: mapped.label ?? name,
                    archetype: mapped.archetype,
                    params: { ...(n.data.params || {}), ...(mapped.params || {}) },
                  },
                }
              : n
          )
        );
      } catch (err) {
        console.error("Failed to update node name", err);
      }
    },
    [apiFetch, mapBackendNodeToData, setNodes]
  );

  const handleParamChange = useCallback(
    async (id: string, key: string, value: any) => {
      const params = new URLSearchParams({ uid: String(id) }).toString();

      try {
        const res = await apiFetch(`/node/update?${params}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updates: { [key]: value } }),
        });

        if (!res.ok) throw new Error("Update failed");
        const backendNode: BackendNode = await res.json();
        const mapped = mapBackendNodeToData(backendNode);

        setNodes((nds) =>
          nds.map((n) =>
            String(n.id) === String(id)
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    label: mapped.label ?? n.data.label,
                    archetype: mapped.archetype,
                    params: { ...(n.data.params || {}), ...(mapped.params || {}) },
                  },
                }
              : n
          )
        );
      } catch (err) {
        console.error("Failed to update node", err);
      }
    },
    [apiFetch, mapBackendNodeToData, setNodes]
  );

  const handleArchetypeChange = useCallback(
    async (id: string, archetype: string) => {
      const params = new URLSearchParams({ uid: String(id), archetype: String(archetype) }).toString();

      try {
        const res = await apiFetch(`/node/archetype?${params}`, { method: "PUT" });
        if (!res.ok) throw new Error("Archetype update failed");

        const backendNode: BackendNode = await res.json();
        const mapped = mapBackendNodeToData(backendNode);

        setNodes((nds) =>
          nds.map((n) =>
            String(n.id) === String(id)
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    label: mapped.label ?? n.data.label,
                    archetype: mapped.archetype,
                    params: { ...(n.data.params || {}), ...(mapped.params || {}) },
                  },
                }
              : n
          )
        );
      } catch (err) {
        console.error("Failed to update archetype", err);
      }
    },
    [apiFetch, mapBackendNodeToData, setNodes]
  );

  // ✅ Добавление ноды (UI + попытка синка с API)
  const handleAddNode = useCallback(async () => {
    const uid = generateUid();

    // центр экрана -> координаты флоу
    const centerScreen = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const pos =
      reactFlowInstance && "screenToFlowPosition" in reactFlowInstance
        ? reactFlowInstance.screenToFlowPosition(centerScreen as any)
        : { x: 180, y: 140 };

    const archetype = "генератор";
    const name = "Нода";

    const getColorLocal = (n: string) => (n === "nothing" ? "#000000" : resources.find((r) => r.name === n)?.color ?? "#000000");

    const optimisticNode: Node<CustomNodeData> = {
      id: String(uid),
      position: { x: pos.x, y: pos.y },
      type: "customNode",
      draggable: true,
      data: {
        label: name,
        archetype,
        params: {
          uid,
          archetype,
          x: pos.x,
          y: pos.y,
          rolled: false,
          in_resource: "nothing",
          out_resource: "nothing",
          in_per_out: 1,
        },

        onDelete: handleDeleteNode,
        onParamChange: handleParamChange,
        onLabelChange: handleLabelChange,
        onArchetypeChange: handleArchetypeChange,

        resourceOptions: resources,
        requestResources: () => fetchAllResources(),
        getResourceColor: getColorLocal,
      },
    };

    // 1) сразу в UI
    setNodes((nds) => [...nds, optimisticNode]);

    // 2) попытка синка с бэком
    try {
      const params = new URLSearchParams({
        uid: String(uid),
        archetype: String(archetype),
        x: String(pos.x),
        y: String(pos.y),
        name: String(name),
      }).toString();

      const res = await apiFetch(`/node/add?${params}`, { method: "POST" });
      if (!res.ok) throw new Error("Backend returned error on /node/add");

      const backendNode: BackendNode = await res.json();
      const mapped = mapBackendNodeToData(backendNode);

      setNodes((nds) =>
        nds.map((n) =>
          String(n.id) === String(uid)
            ? {
                ...n,
                data: {
                  ...n.data,
                  label: mapped.label ?? n.data.label,
                  archetype: mapped.archetype,
                  params: { ...(n.data.params || {}), ...(mapped.params || {}) },
                },
              }
            : n
        )
      );
    } catch (e) {
      console.warn("Add node: не удалось синкнуть с API (/node/add). Нода добавлена только локально.", e);
    }
  }, [
    apiFetch,
    reactFlowInstance,
    resources,
    fetchAllResources,
    mapBackendNodeToData,
    setNodes,
    handleDeleteNode,
    handleParamChange,
    handleLabelChange,
    handleArchetypeChange,
  ]);

  // ---------------- ✅ ОДИН метод загрузки мира ----------------

  const loadWorld = useCallback(
    async (sid: string) => {
      loadAbortRef.current?.abort();
      const ac = new AbortController();
      loadAbortRef.current = ac;

      const token = ++loadTokenRef.current;

      try {
        const resList = await fetchAllResources(ac.signal);

        const getColorLocal = (name: string) =>
          name === "nothing" ? "#000000" : resList.find((r) => r.name === name)?.color ?? "#000000";

        const [nodesRes, connsRes] = await Promise.all([
          apiFetch("/node/all", { method: "GET", signal: ac.signal }),
          apiFetch("/connection/all", { method: "GET", signal: ac.signal }),
        ]);

        if (!nodesRes.ok) throw new Error("Failed /node/all");
        if (!connsRes.ok) throw new Error("Failed /connection/all");

        const allNodes = (await nodesRes.json()) as BackendNode[];
        const allConnections = (await connsRes.json()) as BackendConnection[];

        if (token !== loadTokenRef.current) return;

        const rfNodes: Node<CustomNodeData>[] = (Array.isArray(allNodes) ? allNodes : []).map((bn, idx) => {
          const mapped = mapBackendNodeToData(bn);
          const label = mapped.label ?? "Нода";

          const bx = typeof bn.data?.x === "number" ? bn.data.x : undefined;
          const by = typeof bn.data?.y === "number" ? bn.data.y : undefined;

          const x = bx ?? 120 + (idx % 5) * 280;
          const y = by ?? 120 + Math.floor(idx / 5) * 240;

          return {
            id: String(bn.uid),
            position: { x, y },
            type: "customNode",
            draggable: true,
            data: {
              label,
              archetype: mapped.archetype,
              params: mapped.params,

              onDelete: handleDeleteNode,
              onParamChange: handleParamChange,
              onLabelChange: handleLabelChange,
              onArchetypeChange: handleArchetypeChange,

              resourceOptions: resList,
              requestResources: () => fetchAllResources(),
              getResourceColor: getColorLocal,
            },
          };
        });

        const rfEdges: Edge[] = (Array.isArray(allConnections) ? allConnections : []).map((c) => ({
          id: String(c.uid),
          source: String(c.parent),
          target: String(c.child),
          sourceHandle: dirToSourceHandle(c.parent_dir),
          targetHandle: dirToTargetHandle(c.child_dir),
          animated: true,
          style: { strokeDasharray: "6 3" },
          markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
          data: {
            resource: c.resource ?? "nothing",
            planned_flow: c.planned_flow ?? 0,
            actual_flow: c.actual_flow ?? 0,
            flow_multiplier: c.flow_multiplier ?? 1,
          },
        }));

        setNodes(rfNodes);
        setEdges(rfEdges);
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        console.error("loadWorld failed", err);
      }
    },
    [
      apiFetch,
      fetchAllResources,
      mapBackendNodeToData,
      handleDeleteNode,
      handleParamChange,
      handleLabelChange,
      handleArchetypeChange,
      setNodes,
      setEdges,
    ]
  );

  useEffect(() => {
    if (!sessionId) return;
    loadWorld(sessionId);
    return () => {
      loadAbortRef.current?.abort();
    };
  }, [sessionId, loadWorld]);

  useEffect(() => {
    if (!reactFlowInstance) return;
    if (nodes.length === 0) return;
    requestAnimationFrame(() => {
      reactFlowInstance.fitView({ padding: 0.2, duration: 250 });
    });
  }, [reactFlowInstance, nodes.length]);

  const reloadWorldForSession = useCallback(
    async (sid: string) => {
      localStorage.setItem(SESSION_STORAGE_KEY, sid);
      setSessionId(sid);

      setNodes([]);
      setEdges([]);
      setResources([NOTHING_RESOURCE]);
      setNewResourceName("");
    },
    [setNodes, setEdges]
  );

  const fetchSessions = useCallback(async () => {
    setSessionsLoading(true);
    setSessionsErr(null);
    try {
      const res = await apiFetchNoSession("/world/sessions", { method: "GET" });
      if (!res.ok) throw new Error("Failed /world/sessions");
      const json = await res.json();
      const list = Array.isArray(json) ? (json as any[]).filter((x) => typeof x === "string") : [];
      setSessions(list);
    } catch (e) {
      console.error("Failed to load sessions", e);
      setSessionsErr("Не удалось загрузить список сессий");
      setSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  }, [apiFetchNoSession]);

  const saveNodePosition = useCallback(
    async (id: string, pos: { x: number; y: number }) => {
      const params = new URLSearchParams({ uid: String(id) }).toString();
      try {
        await apiFetch(`/node/update?${params}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updates: { x: pos.x, y: pos.y } }),
        });
      } catch (err) {
        console.error("Failed to save node position", err);
      }
    },
    [apiFetch]
  );

  const handleRestart = useCallback(async () => {
    try {
      await apiFetch("/world/restart", { method: "POST" });
    } catch (err) {
      console.error("Failed to restart session manually", err);
    }
    if (sessionId) loadWorld(sessionId);
  }, [apiFetch, sessionId, loadWorld]);

  const handleResetView = useCallback(() => {
    reactFlowInstance?.setViewport({ x: 0, y: 0, zoom: 1 });
  }, [reactFlowInstance]);

  const handleAddResource = useCallback(async () => {
    const name = newResourceName.trim();
    if (!name) return;

    const params = new URLSearchParams({ name, color: newResourceColor }).toString();

    try {
      const res = await apiFetch(`/resource/add?${params}`, { method: "POST" });
      if (!res.ok) throw new Error("Backend returned error");
      if (sessionId) await loadWorld(sessionId);
      setNewResourceName("");
    } catch (err) {
      console.error("Failed to add resource", err);
    }
  }, [apiFetch, newResourceName, newResourceColor, sessionId, loadWorld]);

  const handleRemoveResource = useCallback(
    async (name: string) => {
      const params = new URLSearchParams({ name }).toString();

      try {
        const res = await apiFetch(`/resource/remove?${params}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Backend returned error");
        if (sessionId) await loadWorld(sessionId);
      } catch (err) {
        console.error("Failed to remove resource", err);
      }
    },
    [apiFetch, sessionId, loadWorld]
  );

  const onEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      setEdges((eds) => eds.filter((e) => e.id !== edge.id));
      const params = new URLSearchParams({ uid: String(edge.id) }).toString();
      apiFetch(`/connection/remove?${params}`, { method: "DELETE" }).catch((err) =>
        console.error("Failed to call /connection/remove", err)
      );
    },
    [apiFetch, setEdges]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const hasSourceConflict =
        connection.source &&
        connection.sourceHandle &&
        edges.some((e) => e.source === connection.source && e.sourceHandle === connection.sourceHandle);

      const hasTargetConflict =
        connection.target &&
        connection.targetHandle &&
        edges.some((e) => e.target === connection.target && e.targetHandle === connection.targetHandle);

      if (hasSourceConflict || hasTargetConflict) {
        console.warn("Этот коннектор уже занят, вторая связь не создаётся");
        return;
      }

      const connectionUid = generateUid();

      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            id: connectionUid,
            animated: true,
            style: { strokeDasharray: "6 3" },
            markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
          },
          eds
        )
      );

      if (connection.source && connection.target) {
        const parentDir = mapHandleToDir(connection.sourceHandle);
        const childDir = mapHandleToDir(connection.targetHandle);

        const params = new URLSearchParams({
          uid: connectionUid,
          parent_id: String(connection.source),
          child_id: String(connection.target),
          parent_dir: parentDir,
          child_dir: childDir,
        }).toString();

        apiFetch(`/connection/add?${params}`, { method: "POST" }).catch((err) =>
          console.error("Failed to call /connection/add", err)
        );
      }
    },
    [edges, apiFetch, setEdges]
  );

  const handleTick = useCallback(async () => {
    try {
      const res = await apiFetch("/world/tick", { method: "GET" });
      if (!res.ok) throw new Error("Tick backend returned error");

      const payload: BackendNode[] = await res.json();

      setNodes((prevNodes) =>
        prevNodes.map((node) => {
          const backendNode = payload.find((n) => String(n.uid) === String(node.id));
          if (!backendNode) return node;

          const mapped = mapBackendNodeToData(backendNode);

          return {
            ...node,
            data: {
              ...node.data,
              label: mapped.label ?? node.data.label,
              archetype: mapped.archetype,
              params: { ...(node.data.params || {}), ...(mapped.params || {}) },
            },
          };
        })
      );
    } catch (error) {
      console.error("Failed to tick backend", error);
    }
  }, [apiFetch, mapBackendNodeToData, setNodes]);

  if (!sessionId) {
    return <div className="node-graph-wrapper">Загрузка сессии...</div>;
  }

  return (
    <div className="node-graph-wrapper">
      <header className="node-graph-header">
        <h1 className="node-graph-title">Node Graph</h1>

        <div className="node-graph-actions">
          {/* ✅ ВОТ ОНА — кнопка добавления ноды */}
          <button className="add-node-button" onClick={handleAddNode} title="Добавить новую ноду">
            + Нода
          </button>

          <button
            className="add-node-button"
            onClick={async () => {
              setIsSessionModalOpen(true);
              await fetchSessions();
            }}
            title="Выбрать/создать сессию"
          >
            Сессия
          </button>

          <button
            className="add-node-button"
            onClick={async () => {
              setIsResourceModalOpen(true);
              try {
                await fetchAllResources();
              } catch {}
            }}
          >
            Ресурсы
          </button>

          <button className="add-node-button" onClick={handleTick}>
            Итерация
          </button>

          <button className="add-node-button" onClick={handleRestart}>
            Рестарт
          </button>

          <button className="add-node-button" onClick={handleResetView}>
            Камера (0, 0)
          </button>
        </div>
      </header>

      {/* Sessions Modal */}
      {isSessionModalOpen && (
        <div className="resource-modal-backdrop" onClick={() => setIsSessionModalOpen(false)}>
          <div className="resource-modal" onClick={(e) => e.stopPropagation()}>
            <div className="resource-modal-header">
              <div className="resource-modal-title">Сессии</div>
              <button className="resource-modal-close" onClick={() => setIsSessionModalOpen(false)} title="Закрыть">
                ×
              </button>
            </div>

            <div className="resource-panel">
              <div className="resource-panel-title">Выбери сессию</div>

              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <button
                  className="resource-add-button"
                  onClick={async () => {
                    await fetchSessions();
                  }}
                  disabled={sessionsLoading}
                  title="Обновить список"
                >
                  Обновить
                </button>
                <div style={{ opacity: 0.7, fontSize: 12, alignSelf: "center" }}>
                  текущая: <b>{sessionId}</b>
                </div>
              </div>

              {sessionsLoading && <div className="resource-list-empty">Загрузка...</div>}
              {!sessionsLoading && sessionsErr && <div className="resource-list-empty">{sessionsErr}</div>}

              {!sessionsLoading && !sessionsErr && (
                <div className="resource-list">
                  <div
                    className="resource-pill"
                    style={{ cursor: "pointer" }}
                    onClick={() => {
                      const newSid = generateUid();
                      setIsSessionModalOpen(false);
                      reloadWorldForSession(newSid);
                    }}
                    title="Создать новую сессию"
                  >
                    <span className="resource-name">➕ новая сессия</span>
                  </div>

                  {sessions.length === 0 ? (
                    <div className="resource-list-empty">Сессий нет (или API вернул пустой список).</div>
                  ) : (
                    sessions.map((sid) => (
                      <div
                        key={sid}
                        className="resource-pill"
                        style={{
                          cursor: "pointer",
                          outline: sid === sessionId ? "2px solid rgba(255,255,255,0.35)" : "none",
                        }}
                        onClick={() => {
                          setIsSessionModalOpen(false);
                          reloadWorldForSession(sid);
                        }}
                        title="Переключиться на сессию"
                      >
                        <span className="resource-name">{sid}</span>
                        {sid === sessionId && <span style={{ marginLeft: 8, opacity: 0.7 }}>(текущая)</span>}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Resources Modal */}
      {isResourceModalOpen && (
        <div className="resource-modal-backdrop" onClick={() => setIsResourceModalOpen(false)}>
          <div className="resource-modal" onClick={(e) => e.stopPropagation()}>
            <div className="resource-modal-header">
              <div className="resource-modal-title">Ресурсы</div>
              <button className="resource-modal-close" onClick={() => setIsResourceModalOpen(false)} title="Закрыть">
                ×
              </button>
            </div>

            <div className="resource-panel">
              <div className="resource-form">
                <div className="resource-panel-title">Добавление ресурса</div>
                <div className="resource-form-row">
                  <input
                    className="resource-input"
                    placeholder="Имя ресурса"
                    value={newResourceName}
                    onChange={(e) => setNewResourceName(e.target.value)}
                  />
                  <input
                    type="color"
                    className="resource-color-input"
                    value={newResourceColor}
                    onChange={(e) => setNewResourceColor(e.target.value)}
                  />
                  <button className="resource-add-button" onClick={handleAddResource}>
                    Добавить
                  </button>
                </div>
              </div>

              <div className="resource-list">
                {resources.length === 0 ? (
                  <div className="resource-list-empty">Ресурсов пока нет — добавь первый.</div>
                ) : (
                  resources.map((r) => (
                    <div key={r.name} className="resource-pill">
                      <span className="resource-color-dot" style={{ backgroundColor: r.color }} />
                      <span className="resource-name">{r.name}</span>
                      {r.name !== "nothing" && (
                        <button className="resource-delete-button" onClick={() => handleRemoveResource(r.name)} title="Удалить ресурс">
                          ×
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="node-graph-canvas">
        <div style={{ width: "100%", height: "100%" }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onEdgeClick={onEdgeClick}
            onConnect={onConnect}
            onInit={setReactFlowInstance}
            fitView
            connectionMode={ConnectionMode.Loose}
            nodesDraggable={true}
            nodesConnectable={true}
            onNodeDragStop={(_, node) => {
              saveNodePosition(String(node.id), node.position);
            }}
          >
            <MiniMap />
            <Controls />
            <Background gap={16} />
          </ReactFlow>
        </div>
      </div>
    </div>
  );
};
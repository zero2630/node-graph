import React, {
  useCallback,
  useEffect,
  useState,
} from "react";
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
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
} from "reactflow";

import "reactflow/dist/style.css";
import "./NodeGraph.css";

// --------- Тип данных ноды на фронте ---------
type CustomNodeData = {
  label: string;                // "Генератор", "Хранилище", "Ресивер", "Трансформер", "Роутер", "Регулятор", ...
  params: Record<string, any>;  // в том числе uid, resource и прочее
  onDelete?: (id: string) => void;
};

// --------- Кастомный компонент ноды ---------
const CustomNode: React.FC<NodeProps<CustomNodeData>> = ({ id, data }) => {
  const entries = Object.entries(data.params);

  const formatKey = (key: string) => key.replace(/_/g, " ");

  const formatValue = (value: any) => {
    if (typeof value === "number") {
      if (Number.isInteger(value)) return value.toString();
      return value.toFixed(2); // округление до двух знаков
    }
    return String(value);
  };

  return (
    <div className="custom-node">
      {/* ШАПКА НАД НОДОЙ */}
      <div className="custom-node-header">
        <span className="custom-node-label">{data.label}</span>
        <button
          className="custom-node-delete"
          onClick={() => data.onDelete?.(id)}
          title="Удалить ноду"
        >
          ×
        </button>
      </div>

      {/* САМА НОДА (ТЕЛО) */}
      <div className="custom-node-body">
        {/* TOP: in/out */}
        <Handle
          id="in-top"
          type="target"
          position={Position.Top}
          className="custom-handle custom-handle-top"
        />
        <Handle
          id="out-top"
          type="source"
          position={Position.Top}
          className="custom-handle custom-handle-top"
        />

        {/* BOTTOM: in/out */}
        <Handle
          id="in-bottom"
          type="target"
          position={Position.Bottom}
          className="custom-handle custom-handle-bottom"
        />
        <Handle
          id="out-bottom"
          type="source"
          position={Position.Bottom}
          className="custom-handle custom-handle-bottom"
        />

        {/* LEFT: in/out */}
        <Handle
          id="in-left"
          type="target"
          position={Position.Left}
          className="custom-handle custom-handle-left"
        />
        <Handle
          id="out-left"
          type="source"
          position={Position.Left}
          className="custom-handle custom-handle-left"
        />

        {/* RIGHT: in/out */}
        <Handle
          id="in-right"
          type="target"
          position={Position.Right}
          className="custom-handle custom-handle-right"
        />
        <Handle
          id="out-right"
          type="source"
          position={Position.Right}
          className="custom-handle custom-handle-right"
        />

        <div className="custom-node-values">
          {entries.length > 0 ? (
            <table className="custom-node-table">
              <thead>
                <tr>
                  <th>параметр</th>
                  <th>значение</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(([key, value]) => (
                  <tr key={key}>
                    <td className="custom-node-table-key">
                      {formatKey(key)}
                    </td>
                    <td className="custom-node-table-value">
                      {formatValue(value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="custom-node-empty">нет параметров</div>
          )}
        </div>
      </div>
    </div>
  );
};

// --------- nodeTypes ---------
const nodeTypes = { customNode: CustomNode };

// --------- Начальные ноды/рёбра (пусто) ---------
const initialNodes: Node<CustomNodeData>[] = [];
const initialEdges: Edge[] = [];

// простая генерация uid для фронта (используем и для нод, и для связей)
const generateUid = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto
    ? (crypto as any).randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

const SESSION_STORAGE_KEY = "node_world_session_id";

// --------- Тип ответа узла от бэка ---------
type BackendNode = {
  uid: string;
  data: {
    archetype: string; // "generator" | "store" | "receiver" | "transformer" | "router" | "regulator" | ...
    connections: {
      in: {
        up: string | null;
        down: string | null;
        left: string | null;
        right: string | null;
      };
      out: {
        up: string | null;
        down: string | null;
        left: string | null;
        right: string | null;
      };
    };
    capacity?: number;
    stored?: number;
    max_out?: number;
    generate_per_tick?: number;
    total_generated?: number;
    resource?: string | null;
    in_resource?: string;
    out_resource?: string;
    in_per_out?: number;
    max_out_per_tick?: number;
    buffer_in?: number;
    [key: string]: any;
  };
};

export const NodeGraph: React.FC = () => {
  const [sessionId, setSessionId] = useState<string | null>(null);

  const [nodes, setNodes, onNodesChange] =
    useNodesState<CustomNodeData>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Инициализация / восстановление session_id из localStorage
  useEffect(() => {
    let sid = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!sid) {
      sid = generateUid();
      localStorage.setItem(SESSION_STORAGE_KEY, sid);
    }
    setSessionId(sid);
  }, []);

  // Обёртка над fetch, которая добавляет session_id к каждому запросу
  const apiFetch = useCallback(
    (path: string, options?: RequestInit) => {
      const base = "http://127.0.0.1:8502";
      const hasQuery = path.includes("?");
      const sid = sessionId;

      const url =
        sid != null
          ? `${base}${path}${hasQuery ? "&" : "?"}session_id=${encodeURIComponent(
              sid
            )}`
          : `${base}${path}`;

      return fetch(url, options);
    },
    [sessionId]
  );

  const mapHandleToDir = (handleId?: string | null): string => {
    if (!handleId) return "right";
    if (handleId.includes("top")) return "up";
    if (handleId.includes("bottom")) return "down";
    if (handleId.includes("left")) return "left";
    if (handleId.includes("right")) return "right";
    return "right";
  };

  const handleDeleteNode = useCallback(
    (id: string) => {
      const edgesToRemove = edges.filter(
        (e) => e.source === id || e.target === id
      );

      edgesToRemove.forEach((edge) => {
        const params = new URLSearchParams({
          uid: edge.id,
        }).toString();

        apiFetch(`/node/remove_connection?${params}`, {
          method: "POST",
        }).catch((err) => {
          console.error("Failed to call /node/remove_connection", err);
        });
      });

      setEdges((eds) =>
        eds.filter((e) => e.source !== id && e.target !== id)
      );

      setNodes((nds) => nds.filter((n) => n.id !== id));

      const params = new URLSearchParams({ uid: id }).toString();
      apiFetch(`/node/remove_node?${params}`, {
        method: "POST",
      }).catch((err) => {
        console.error("Failed to call /node/remove_node", err);
      });
    },
    [edges, apiFetch, setEdges, setNodes]
  );

  // Прокидываем onDelete в уже существующие ноды
  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        data: {
          ...n.data,
          onDelete: handleDeleteNode,
        },
      }))
    );
  }, [handleDeleteNode, setNodes]);

  // --------- Маппинг backend → CustomNodeData ---------
  const mapBackendNodeToData = (backend: BackendNode): CustomNodeData => {
    const archetype = backend.data.archetype;

    const baseLabel =
      archetype === "generator"
        ? "Генератор"
        : archetype === "store"
        ? "Хранилище"
        : archetype === "receiver"
        ? "Ресивер"
        : archetype === "transformer"
        ? "Трансформер"
        : archetype === "router"
        ? "Роутер"
        : archetype === "regulator"
        ? "Регулятор"
        : archetype;

    const { archetype: _a, connections: _c, ...rest } = backend.data;

    const params: Record<string, any> = {
      uid: backend.uid,
      ...rest,
    };

    return {
      label: baseLabel,
      params,
    };
  };

  // ------ АВТО-РЕСТАРТ СЕССИИ ПРИ ЗАГРУЗКЕ СТРАНИЦЫ ------
  useEffect(() => {
    if (!sessionId) return;

    const doRestart = async () => {
      try {
        await apiFetch("/node/restart", { method: "POST" });
      } catch (err) {
        console.error("Failed to restart session on mount", err);
      }
      // Очищаем локальный граф
      setNodes([]);
      setEdges([]);
    };

    doRestart();
  }, [sessionId, apiFetch, setNodes, setEdges]);

  // ------ Рестарт по кнопке ------
  const handleRestart = useCallback(async () => {
    try {
      await apiFetch("/node/restart", { method: "POST" });
    } catch (err) {
      console.error("Failed to restart session manually", err);
    }
    setNodes([]);
    setEdges([]);
  }, [apiFetch, setNodes, setEdges]);

  // ------ Создание генератора ------
  const handleCreateGenerator = useCallback(
    async (resource: string) => {
      const uid = generateUid();

      try {
        const res = await apiFetch("/node/add", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            archetype: "generator",
            uid,
            resource,
          }),
        });

        if (!res.ok) throw new Error("Backend returned error");

        const backendNode: BackendNode = await res.json();
        const mapped = mapBackendNodeToData(backendNode);

        const newNode: Node<CustomNodeData> = {
          id: backendNode.uid ?? uid,
          position: {
            x: 100 + Math.random() * 400,
            y: 100 + Math.random() * 200,
          },
          data: {
            ...mapped,
            onDelete: handleDeleteNode,
          },
          type: "customNode",
        };

        setNodes((nds) => [...nds, newNode]);
      } catch (error) {
        console.error(
          "Failed to create generator via API, using local fallback",
          error
        );

        setNodes((nds) => {
          const uidLocal = generateUid();
          const newNode: Node<CustomNodeData> = {
            id: uidLocal,
            position: {
              x: 100 + nds.length * 80,
              y: 150,
            },
            data: {
              label: "Генератор",
              params: { uid: uidLocal, resource, fallback: true },
              onDelete: handleDeleteNode,
            },
            type: "customNode",
          };
          return [...nds, newNode];
        });
      }
    },
    [apiFetch, handleDeleteNode, setNodes]
  );

  // ------ Создание хранилища ------
  const handleCreateStore = useCallback(
    async (resource: string) => {
      const uid = generateUid();

      try {
        const res = await apiFetch("/node/add", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            archetype: "store",
            uid,
            resource,
          }),
        });

        if (!res.ok) throw new Error("Backend returned error");

        const backendNode: BackendNode = await res.json();
        const mapped = mapBackendNodeToData(backendNode);

        const newNode: Node<CustomNodeData> = {
          id: backendNode.uid ?? uid,
          position: {
            x: 100 + Math.random() * 400,
            y: 100 + Math.random() * 200,
          },
          data: {
            ...mapped,
            onDelete: handleDeleteNode,
          },
          type: "customNode",
        };

        setNodes((nds) => [...nds, newNode]);
      } catch (error) {
        console.error(
          "Failed to create store via API, using local fallback",
          error
        );

        setNodes((nds) => {
          const uidLocal = generateUid();
          const newNode: Node<CustomNodeData> = {
            id: uidLocal,
            position: {
              x: 100 + nds.length * 80,
              y: 220,
            },
            data: {
              label: "Хранилище",
              params: { uid: uidLocal, resource, fallback: true },
              onDelete: handleDeleteNode,
            },
            type: "customNode",
          };
          return [...nds, newNode];
        });
      }
    },
    [apiFetch, handleDeleteNode, setNodes]
  );

  // ------ Создание ресивера ------
  const handleCreateReceiver = useCallback(
    async (resource: string) => {
      const uid = generateUid();

      try {
        const res = await apiFetch("/node/add", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            archetype: "receiver",
            uid,
            resource,
          }),
        });

        if (!res.ok) throw new Error("Backend returned error");

        const backendNode: BackendNode = await res.json();
        const mapped = mapBackendNodeToData(backendNode);

        const newNode: Node<CustomNodeData> = {
          id: backendNode.uid ?? uid,
          position: {
            x: 100 + Math.random() * 400,
            y: 100 + Math.random() * 200,
          },
          data: {
            ...mapped,
            onDelete: handleDeleteNode,
          },
          type: "customNode",
        };

        setNodes((nds) => [...nds, newNode]);
      } catch (error) {
        console.error(
          "Failed to create receiver via API, using local fallback",
          error
        );

        setNodes((nds) => {
          const uidLocal = generateUid();
          const newNode: Node<CustomNodeData> = {
            id: uidLocal,
            position: {
              x: 100 + nds.length * 80,
              y: 290,
            },
            data: {
              label: "Ресивер",
              params: { uid: uidLocal, resource, fallback: true },
              onDelete: handleDeleteNode,
            },
            type: "customNode",
          };
          return [...nds, newNode];
        });
      }
    },
    [apiFetch, handleDeleteNode, setNodes]
  );

  // ------ Создание трансформера ------
  // Хлеб → resource = "wheat"; Металл → resource = "ore"
  const handleCreateTransformer = useCallback(
    async (resource: "wheat" | "ore") => {
      const uid = generateUid();

      try {
        const res = await apiFetch("/node/add", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            archetype: "transformer",
            uid,
            resource,
          }),
        });

        if (!res.ok) throw new Error("Backend returned error");

        const backendNode: BackendNode = await res.json();
        const mapped = mapBackendNodeToData(backendNode);

        const newNode: Node<CustomNodeData> = {
          id: backendNode.uid ?? uid,
          position: {
            x: 100 + Math.random() * 400,
            y: 100 + Math.random() * 200,
          },
          data: {
            ...mapped,
            onDelete: handleDeleteNode,
          },
          type: "customNode",
        };

        setNodes((nds) => [...nds, newNode]);
      } catch (error) {
        console.error(
          "Failed to create transformer via API, using local fallback",
          error
        );

        setNodes((nds) => {
          const uidLocal = generateUid();
          const newNode: Node<CustomNodeData> = {
            id: uidLocal,
            position: {
              x: 100 + nds.length * 80,
              y: 360,
            },
            data: {
              label: "Трансформер",
              params: { uid: uidLocal, resource, fallback: true },
              onDelete: handleDeleteNode,
            },
            type: "customNode",
          };
          return [...nds, newNode];
        });
      }
    },
    [apiFetch, handleDeleteNode, setNodes]
  );

  // ------ Создание роутера ------
  const handleCreateRouter = useCallback(
    async (resource: string) => {
      const uid = generateUid();

      try {
        const res = await apiFetch("/node/add", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            archetype: "router",
            uid,
            resource,
          }),
        });

        if (!res.ok) throw new Error("Backend returned error");

        const backendNode: BackendNode = await res.json();
        const mapped = mapBackendNodeToData(backendNode);

        const newNode: Node<CustomNodeData> = {
          id: backendNode.uid ?? uid,
          position: {
            x: 100 + Math.random() * 400,
            y: 100 + Math.random() * 200,
          },
          data: {
            ...mapped,
            onDelete: handleDeleteNode,
          },
          type: "customNode",
        };

        setNodes((nds) => [...nds, newNode]);
      } catch (error) {
        console.error(
          "Failed to create router via API, using local fallback",
          error
        );

        setNodes((nds) => {
          const uidLocal = generateUid();
          const newNode: Node<CustomNodeData> = {
            id: uidLocal,
            position: {
              x: 100 + nds.length * 80,
              y: 430,
            },
            data: {
              label: "Роутер",
              params: { uid: uidLocal, resource, fallback: true },
              onDelete: handleDeleteNode,
            },
            type: "customNode",
          };
          return [...nds, newNode];
        });
      }
    },
    [apiFetch, handleDeleteNode, setNodes]
  );

  // ------ Создание регулятора ------
  const handleCreateRegulator = useCallback(
    async (resource: string) => {
      const uid = generateUid();

      try {
        const res = await apiFetch("/node/add", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            archetype: "regulator",
            uid,
            resource,
          }),
        });

        if (!res.ok) throw new Error("Backend returned error");

        const backendNode: BackendNode = await res.json();
        const mapped = mapBackendNodeToData(backendNode);

        const newNode: Node<CustomNodeData> = {
          id: backendNode.uid ?? uid,
          position: {
            x: 100 + Math.random() * 400,
            y: 100 + Math.random() * 200,
          },
          data: {
            ...mapped,
            onDelete: handleDeleteNode,
          },
          type: "customNode",
        };

        setNodes((nds) => [...nds, newNode]);
      } catch (error) {
        console.error(
          "Failed to create regulator via API, using local fallback",
          error
        );

        setNodes((nds) => {
          const uidLocal = generateUid();
          const newNode: Node<CustomNodeData> = {
            id: uidLocal,
            position: {
              x: 100 + nds.length * 80,
              y: 500,
            },
            data: {
              label: "Регулятор",
              params: { uid: uidLocal, resource, fallback: true },
              onDelete: handleDeleteNode,
            },
            type: "customNode",
          };
          return [...nds, newNode];
        });
      }
    },
    [apiFetch, handleDeleteNode, setNodes]
  );

  // ------ Удаление связи по клику ------
  const onEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      setEdges((eds) => eds.filter((e) => e.id !== edge.id));

      const params = new URLSearchParams({
        uid: edge.id,
      }).toString();

      apiFetch(`/node/remove_connection?${params}`, {
        method: "POST",
      }).catch((err) => {
        console.error("Failed to call /node/remove_connection", err);
      });
    },
    [apiFetch, setEdges]
  );

  // ------ Создание связи между нодами ------
  const onConnect = useCallback(
    (connection: Connection) => {
      const hasSourceConflict =
        connection.source &&
        connection.sourceHandle &&
        edges.some(
          (e) =>
            e.source === connection.source &&
            e.sourceHandle === connection.sourceHandle
        );

      const hasTargetConflict =
        connection.target &&
        connection.targetHandle &&
        edges.some(
          (e) =>
            e.target === connection.target &&
            e.targetHandle === connection.targetHandle
        );

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
            markerEnd: {
              type: MarkerType.ArrowClosed,
              width: 18,
              height: 18,
            },
          },
          eds
        )
      );

      if (connection.source && connection.target) {
        const parentDir = mapHandleToDir(connection.sourceHandle);
        const childDir = mapHandleToDir(connection.targetHandle);

        const params = new URLSearchParams({
          uid: connectionUid,
          parent_id: connection.source,
          child_id: connection.target,
          parent_dir: parentDir,
          child_dir: childDir,
        }).toString();

        apiFetch(`/node/add_connection?${params}`, {
          method: "POST",
        }).catch((err) => {
          console.error("Failed to call /node/add_connection", err);
        });
      }
    },
    [edges, apiFetch, setEdges]
  );

  // ------ ИТЕРАЦИЯ ------
  const handleTick = useCallback(async () => {
    try {
      const res = await apiFetch("/node/tick", {
        method: "POST",
      });

      if (!res.ok) throw new Error("Tick backend returned error");

      const payload: BackendNode[] = await res.json();

      setNodes((prevNodes) =>
        prevNodes.map((node) => {
          const backendNode = payload.find(
            (n) => String(n.uid) === String(node.id)
          );
          if (!backendNode) return node;

          const mapped = mapBackendNodeToData(backendNode);

          return {
            ...node,
            data: {
              ...node.data,
              ...mapped,
              onDelete: node.data.onDelete,
            },
          };
        })
      );
    } catch (error) {
      console.error("Failed to tick backend", error);
    }
  }, [apiFetch, setNodes]);

  if (!sessionId) {
    return <div className="node-graph-wrapper">Загрузка сессии...</div>;
  }

  return (
    <div className="node-graph-wrapper">
      <header className="node-graph-header">
        <h1 className="node-graph-title">Node Graph</h1>
        <div className="node-graph-actions">
          {/* Генератор */}
          <div className="dropdown">
            <button className="add-node-button">
              Добавить генератор
            </button>
            <div className="dropdown-menu">
              <button
                className="dropdown-menu-button"
                onClick={() => handleCreateGenerator("energy")}
              >
                Энергия
              </button>
              <button
                className="dropdown-menu-button"
                onClick={() => handleCreateGenerator("wheat")}
              >
                Пшеница
              </button>
              <button
                className="dropdown-menu-button"
                onClick={() => handleCreateGenerator("ore")}
              >
                Руда
              </button>
            </div>
          </div>

          {/* Хранилище */}
          <div className="dropdown">
            <button className="add-node-button">
              Добавить хранилище
            </button>
            <div className="dropdown-menu">
              <button
                className="dropdown-menu-button"
                onClick={() => handleCreateStore("energy")}
              >
                Энергия
              </button>
              <button
                className="dropdown-menu-button"
                onClick={() => handleCreateStore("wheat")}
              >
                Пшеница
              </button>
              <button
                className="dropdown-menu-button"
                onClick={() => handleCreateStore("bread")}
              >
                Хлеб
              </button>
              <button
                className="dropdown-menu-button"
                onClick={() => handleCreateStore("ore")}
              >
                Руда
              </button>
              <button
                className="dropdown-menu-button"
                onClick={() => handleCreateStore("metal")}
              >
                Металл
              </button>
            </div>
          </div>

          {/* Ресивер */}
          <div className="dropdown">
            <button className="add-node-button">
              Добавить ресивер
            </button>
            <div className="dropdown-menu">
              <button
                className="dropdown-menu-button"
                onClick={() => handleCreateReceiver("energy")}
              >
                Энергия
              </button>
              <button
                className="dropdown-menu-button"
                onClick={() => handleCreateReceiver("wheat")}
              >
                Пшеница
              </button>
              <button
                className="dropdown-menu-button"
                onClick={() => handleCreateReceiver("bread")}
              >
                Хлеб
              </button>
              <button
                className="dropdown-menu-button"
                onClick={() => handleCreateReceiver("ore")}
              >
                Руда
              </button>
              <button
                className="dropdown-menu-button"
                onClick={() => handleCreateReceiver("metal")}
              >
                Металл
              </button>
            </div>
          </div>

          {/* Трансформер: Хлеб (wheat) и Металл (ore) */}
          <div className="dropdown">
            <button className="add-node-button">
              Добавить трансформер
            </button>
            <div className="dropdown-menu">
              <button
                className="dropdown-menu-button"
                onClick={() => handleCreateTransformer("wheat")}
              >
                Хлеб
              </button>
              <button
                className="dropdown-menu-button"
                onClick={() => handleCreateTransformer("ore")}
              >
                Металл
              </button>
            </div>
          </div>

          {/* Роутер */}
          <div className="dropdown">
            <button className="add-node-button">
              Добавить роутер
            </button>
            <div className="dropdown-menu">
              <button
                className="dropdown-menu-button"
                onClick={() => handleCreateRouter("energy")}
              >
                Энергия
              </button>
              <button
                className="dropdown-menu-button"
                onClick={() => handleCreateRouter("wheat")}
              >
                Пшеница
              </button>
              <button
                className="dropdown-menu-button"
                onClick={() => handleCreateRouter("bread")}
              >
                Хлеб
              </button>
              <button
                className="dropdown-menu-button"
                onClick={() => handleCreateRouter("ore")}
              >
                Руда
              </button>
              <button
                className="dropdown-menu-button"
                onClick={() => handleCreateRouter("metal")}
              >
                Металл
              </button>
            </div>
          </div>

          {/* Регулятор */}
          <div className="dropdown">
            <button className="add-node-button">
              Добавить регулятор
            </button>
            <div className="dropdown-menu">
              <button
                className="dropdown-menu-button"
                onClick={() => handleCreateRegulator("energy")}
              >
                Энергия
              </button>
              <button
                className="dropdown-menu-button"
                onClick={() => handleCreateRegulator("wheat")}
              >
                Пшеница
              </button>
              <button
                className="dropdown-menu-button"
                onClick={() => handleCreateRegulator("bread")}
              >
                Хлеб
              </button>
              <button
                className="dropdown-menu-button"
                onClick={() => handleCreateRegulator("ore")}
              >
                Руда
              </button>
              <button
                className="dropdown-menu-button"
                onClick={() => handleCreateRegulator("metal")}
              >
                Металл
              </button>
            </div>
          </div>

          {/* Кнопки управления симуляцией */}
          <button className="add-node-button" onClick={handleTick}>
            Итерация
          </button>
          <button className="add-node-button" onClick={handleRestart}>
            Рестарт
          </button>
        </div>
      </header>

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
            fitView
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

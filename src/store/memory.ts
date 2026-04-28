// 历史 import 路径（"../store/memory.js"）保留。实现已迁移到 memory-md.ts（markdown 存储）。
// SQLite memories 表保留作冷备但不再读写。
export {
  addMemory,
  deleteMemory,
  getAllMemories,
  getMemoriesByType,
  searchMemories,
  type MemoryRow,
} from "./memory-md.js";

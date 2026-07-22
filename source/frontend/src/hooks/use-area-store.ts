import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AreaState {
  selectedAreaId: number | null;
  setSelectedArea: (id: number | null) => void;
}

export const useAreaStore = create<AreaState>()(
  persist(
    (set) => ({
      selectedAreaId: null,
      setSelectedArea: (id) => set({ selectedAreaId: id }),
    }),
    { name: "lab-area" },
  ),
);

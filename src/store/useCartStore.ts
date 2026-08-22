"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
export type CartShippingMode="vault"|"ship";
interface CartUiState{selectedIds:string[];shippingModes:Record<string,CartShippingMode>;toggleSelected:(id:string)=>void;setShippingMode:(storeId:string,mode:CartShippingMode)=>void;clearSelection:()=>void}
export const useCartStore=create<CartUiState>()(persist((set)=>({selectedIds:[],shippingModes:{},toggleSelected:(id)=>set(s=>({selectedIds:s.selectedIds.includes(id)?s.selectedIds.filter(value=>value!==id):[...s.selectedIds,id]})),setShippingMode:(storeId,mode)=>set(s=>({shippingModes:{...s.shippingModes,[storeId]:mode}})),clearSelection:()=>set({selectedIds:[]})}),{name:"ninetynine-cart-ui-v1",partialize:s=>({selectedIds:s.selectedIds,shippingModes:s.shippingModes})}));

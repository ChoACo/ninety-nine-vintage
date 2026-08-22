"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
export type WishlistFilter="all"|"available"|"sold"|"center";
interface WishlistUiState{filter:WishlistFilter;auctionAlerts:boolean;setFilter:(filter:WishlistFilter)=>void;setAuctionAlerts:(enabled:boolean)=>void}
export const useWishlistStore=create<WishlistUiState>()(persist(set=>({filter:"all",auctionAlerts:true,setFilter:filter=>set({filter}),setAuctionAlerts:auctionAlerts=>set({auctionAlerts})}),{name:"ninetynine-wishlist-ui-v1"}));

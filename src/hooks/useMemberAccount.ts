"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteMyShippingAddress,
  fetchMyMemberAccount,
  fetchMyShippingAddresses,
  fetchMyWonProducts,
  MemberAccountError,
  requestMyProductShipping,
  saveMyShippingAddress,
  type MemberAccount,
  type MemberShippingAddress,
  type MemberWonProduct,
  type SaveShippingAddressInput,
} from "@/src/lib/supabase/memberAccount";
import {
  MEMBER_ACCOUNT_CHANGED_EVENT,
  type MemberAccountChangedDetail,
} from "@/src/lib/memberAccountEvents";

export interface MemberAccountState {
  account: MemberAccount | null;
  addresses: MemberShippingAddress[];
  wonProducts: MemberWonProduct[];
  isLoading: boolean;
  isMutating: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  saveAddress: (input: SaveShippingAddressInput) => Promise<void>;
  deleteAddress: (addressId: string) => Promise<void>;
  requestShipping: (
    productIds: readonly string[],
    addressId: string,
  ) => Promise<string>;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof MemberAccountError || error instanceof Error
    ? error.message
    : fallback;
}

export function useMemberAccount(memberId: string): MemberAccountState {
  const [account, setAccount] = useState<MemberAccount | null>(null);
  const [addresses, setAddresses] = useState<MemberShippingAddress[]>([]);
  const [wonProducts, setWonProducts] = useState<MemberWonProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const loadData = useCallback(
    async (showLoading: boolean) => {
      const requestId = ++requestIdRef.current;
      if (showLoading) setIsLoading(true);
      setError(null);

      try {
        const [nextAccount, nextAddresses, nextWonProducts] = await Promise.all([
          fetchMyMemberAccount(memberId),
          fetchMyShippingAddresses(memberId),
          fetchMyWonProducts(),
        ]);
        if (!nextAccount) {
          throw new MemberAccountError(
            "회원 배송 계정이 아직 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.",
          );
        }
        if (requestId !== requestIdRef.current) return;

        setAccount(nextAccount);
        setAddresses(nextAddresses);
        setWonProducts(nextWonProducts);
      } catch (loadError) {
        if (requestId !== requestIdRef.current) return;
        const message = getErrorMessage(
          loadError,
          "회원 배송 정보를 불러오지 못했습니다.",
        );
        setAccount(null);
        setAddresses([]);
        setWonProducts([]);
        setError(message);
        if (!showLoading) {
          throw new MemberAccountError(message, { cause: loadError });
        }
      } finally {
        if (requestId === requestIdRef.current) setIsLoading(false);
      }
    },
    [memberId],
  );

  const refresh = useCallback(async () => {
    await loadData(true);
  }, [loadData]);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => void loadData(true), 0);
    const handleAccountChanged = (
      event: Event,
    ) => {
      const detail = (event as CustomEvent<MemberAccountChangedDetail>).detail;
      if (detail?.memberId !== memberId) return;
      void loadData(false).catch(() => undefined);
    };
    window.addEventListener(MEMBER_ACCOUNT_CHANGED_EVENT, handleAccountChanged);
    return () => {
      window.clearTimeout(loadTimer);
      window.removeEventListener(
        MEMBER_ACCOUNT_CHANGED_EVENT,
        handleAccountChanged,
      );
      requestIdRef.current += 1;
    };
  }, [loadData, memberId]);

  const saveAddress = useCallback(
    async (input: SaveShippingAddressInput) => {
      setIsMutating(true);
      setError(null);
      try {
        await saveMyShippingAddress(input);
        await loadData(false);
      } catch (saveError) {
        const message = getErrorMessage(saveError, "배송지를 저장하지 못했습니다.");
        setError(message);
        throw new MemberAccountError(message, { cause: saveError });
      } finally {
        setIsMutating(false);
      }
    },
    [loadData],
  );

  const deleteAddress = useCallback(
    async (addressId: string) => {
      setIsMutating(true);
      setError(null);
      try {
        await deleteMyShippingAddress(addressId);
        await loadData(false);
      } catch (deleteError) {
        const message = getErrorMessage(
          deleteError,
          "배송지를 삭제하지 못했습니다.",
        );
        setError(message);
        throw new MemberAccountError(message, { cause: deleteError });
      } finally {
        setIsMutating(false);
      }
    },
    [loadData],
  );

  const requestShipping = useCallback(
    async (productIds: readonly string[], addressId: string) => {
      setIsMutating(true);
      setError(null);
      try {
        const requestId = await requestMyProductShipping(productIds, addressId);
        await loadData(false);
        return requestId;
      } catch (requestError) {
        const message = getErrorMessage(
          requestError,
          "택배 접수를 완료하지 못했습니다.",
        );
        setError(message);
        throw new MemberAccountError(message, { cause: requestError });
      } finally {
        setIsMutating(false);
      }
    },
    [loadData],
  );

  return {
    account,
    addresses,
    wonProducts,
    isLoading,
    isMutating,
    error,
    refresh,
    saveAddress,
    deleteAddress,
    requestShipping,
  };
}

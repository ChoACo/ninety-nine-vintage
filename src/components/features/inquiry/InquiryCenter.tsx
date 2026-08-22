"use client";
import { useState } from "react";
import { InquiryForm } from "@/components/features/inquiry/InquiryForm";
import { InquiryList } from "@/components/features/inquiry/InquiryList";
export function InquiryCenter({ listOnly = false }: { listOnly?: boolean }) { const [revision, setRevision] = useState(0); return <div className="space-y-8">{!listOnly && <InquiryForm onCreated={() => setRevision((value) => value + 1)} />}<InquiryList revision={revision} /></div>; }

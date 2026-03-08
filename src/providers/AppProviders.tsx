"use client";

import { PropsWithChildren } from "react";

import { AuthProvider } from "@/context/AuthContext";
import { ReactQueryProvider } from "@/lib/react-query/provider";

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <ReactQueryProvider>
      <AuthProvider>{children}</AuthProvider>
    </ReactQueryProvider>
  );
}

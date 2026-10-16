"use client";

import { useMemo } from "react";
import { CopilotKit } from "@copilotkit/react-core";
import { HttpAgent } from "@ag-ui/client";
import { AGENT_ID } from "./lib/useZenyCanvas";

// react-core 1.71 habla AG-UI: conectamos un HttpAgent directo al backend Python
// (POST /agui), sin runtime intermedio. El nombre debe coincidir con el agente
// registrado en el backend: "zeny" (docs/CONTRATO_UI.md).
export function Providers({ children }: { children: React.ReactNode }) {
  const agent = useMemo(
    () =>
      new HttpAgent({
        url: process.env.NEXT_PUBLIC_AGUI_URL || "http://localhost:8100/agui",
      }),
    [],
  );

  return (
    <CopilotKit
      agent={AGENT_ID}
      agents__unsafe_dev_only={{ [AGENT_ID]: agent }}
      showDevConsole={false}
      enableInspector={false}
    >
      {children}
    </CopilotKit>
  );
}

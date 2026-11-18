// Uji kompatibilitas SDK aplikasi <-> CLI runtime Copilot (dijalankan DI DALAM container web):
//   docker exec -i -w /app zaltr-web node --input-type=module < bin/zaltr-copilot-probe.mjs
// Meniru koneksi asli aplikasi (start + ping). Gagal bila protokol CLI di luar jangkauan SDK
// ("SDK protocol version mismatch"), supaya update CLI otomatis bisa di-rollback.
import { CopilotClient, RuntimeConnection } from "@github/copilot-sdk";

const token = process.env.ZALTR_COPILOT_CONNECTION_TOKEN;
const client = new CopilotClient({
  connection: RuntimeConnection.forUri(process.env.ZALTR_COPILOT_URL, token ? { connectionToken: token } : undefined),
  mode: "empty",
});
try {
  await client.start();
  await client.ping();
  console.log("PROBE_OK");
  await client.stop();
} catch (e) {
  console.log("PROBE_FAIL " + String(e?.message ?? e).slice(0, 200));
  process.exit(1);
}

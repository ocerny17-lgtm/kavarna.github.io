<?php
// Jednoduché API pro ukládání objednávek na Synology NAS.
// Umísti do: /web/kavarna-api/orders.php (cesta podle API_BASE v index.html).

header('Content-Type: application/json; charset=utf-8');

$store = __DIR__ . '/orders.json';

function read_orders(string $store): array {
  if (!file_exists($store)) {
    return [];
  }
  $data = json_decode(file_get_contents($store), true);
  return is_array($data) ? $data : [];
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
  echo json_encode(['orders' => read_orders($store)]);
  exit;
}

if ($method === 'POST') {
  $body = json_decode(file_get_contents('php://input'), true);
  if (!isset($body['orders']) || !is_array($body['orders'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Bad payload']);
    exit;
  }
  file_put_contents($store, json_encode($body['orders'], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
  echo json_encode(['ok' => true]);
  exit;
}

http_response_code(405);
echo json_encode(['error' => 'Method not allowed']);


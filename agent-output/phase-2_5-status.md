# Phase 2.5: チケット登録

- 目的: architect 出力の全チケットを TaskCreate で登録し、依存関係を設定する
- 開始日: 2026-04-10
- 更新日: 2026-04-10

## Spec Alignment

- spec.md の全機能を実装する34チケット + 6 Evaluate タスクを登録

## Phase

Complete (pass)

## Completed

- 34 Implement タスク登録（#5-#38）
- 6 Evaluate タスク登録（#39-#44）
- 全タスクの依存関係（addBlockedBy）設定
- Phase 7（#4）の blockedBy に全 Evaluate タスク追加

## タスクID マッピング

| チケット | タスクID | チケット | タスクID |
| -------- | -------- | -------- | -------- |
| 1001     | #5       | 3005     | #21      |
| 1002     | #6       | 3006     | #22      |
| 1003     | #7       | 3007     | #23      |
| 1004     | #8       | 3008     | #24      |
| 1005     | #9       | 4001     | #25      |
| 1006     | #10      | 4002     | #26      |
| 2001     | #11      | 4003     | #27      |
| 2002     | #12      | 4004     | #28      |
| 2003     | #13      | 4005     | #29      |
| 2004     | #14      | 5001     | #30      |
| 2005     | #15      | 5002     | #31      |
| 2006     | #16      | 5003     | #32      |
| 3001     | #17      | 5004     | #33      |
| 3002     | #18      | 5005     | #34      |
| 3003     | #19      | 6001     | #35      |
| 3004     | #20      | 6002     | #36      |
|          |          | 6003     | #37      |
|          |          | 6004     | #38      |

## Evaluate タスク

| タスク           | タスクID | blockedBy |
| ---------------- | -------- | --------- |
| Evaluate Phase 1 | #39      | #5-#10    |
| Evaluate Phase 2 | #40      | #11-#16   |
| Evaluate Phase 3 | #41      | #17-#24   |
| Evaluate Phase 4 | #42      | #25-#29   |
| Evaluate Phase 5 | #43      | #30-#34   |
| Evaluate Phase 6 | #44      | #35-#38   |

## In Progress

- なし

## Not Started

- なし

## Failed Tests / Known Issues

- なし

## Key Decisions

- 全 Implement タスクに Phase 2.5（#3）を blockedBy に含めている
- task-6004（統合テスト）は全 Implement タスクを blockedBy に設定

## Next Step

- blockedBy が空の pending タスクを取得し、Implement フェーズを開始する
- 最初に着手可能: #5（task-1001: モノレポ初期化）

## Files Changed

- agent-output/phase-2_5-status.md（新規作成）

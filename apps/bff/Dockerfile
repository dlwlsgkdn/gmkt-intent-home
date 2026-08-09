# DDAK BFF 컨테이너 (DESIGN-PIPELINE-LANGGRAPH.md §6 — 프로덕션 이관 준비)
# 빌드 컨텍스트는 리포 루트: docker build -f apps/bff/Dockerfile -t ddak-bff .
# 워크스페이스 모노레포라 루트 락파일로 설치하고 schema → pipeline → bff 순서로 빌드한다.

FROM node:22-alpine AS build
WORKDIR /repo
# 워크스페이스 그래프(락파일 검증)에 전 워크스페이스 manifest가 필요하다.
# packages/*는 통째로 먼저 — npm ci가 워크스페이스 prepare(tsc)를 실행하므로 소스가 있어야 한다
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps/bff/package.json apps/bff/
COPY apps/core/package.json apps/core/
COPY apps/studio/package.json apps/studio/
RUN npm ci --no-audit --no-fund
COPY apps/bff ./apps/bff
RUN npm run build --workspace=apps/bff

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /repo
# 러너는 빌드 스테이지의 node_modules를 그대로 쓴다 — 워크스페이스 심링크(@ddak/*)가 dist를 가리킨다.
# (dev 의존성 프루닝은 이미지 최적화 단계로 미룬다 — 실험실 기준 명료성 우선)
COPY --from=build /repo/package.json /repo/package-lock.json ./
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/schema ./packages/schema
COPY --from=build /repo/packages/pipeline ./packages/pipeline
COPY --from=build /repo/apps/bff ./apps/bff
EXPOSE 8788
CMD ["node", "apps/bff/dist/main.js"]

# Helper Makefile for Cloud Build and Kubernetes deploys
# Override PROJECT and NAMESPACE as needed, e.g.:
#   make build PROJECT=golden-cosmos-450417-i8

PROJECT ?= golden-cosmos-450417-i8
NAMESPACE ?= default
BACKEND_IMAGE := gcr.io/$(PROJECT)/testifi-backend
WORKER_IMAGE := gcr.io/$(PROJECT)/summarize-worker

.PHONY: build last-build-id deploy-backend deploy-worker deploy-all

build:
	gcloud builds submit backend --config backend/backend-cloudbuild.yaml --project $(PROJECT)

last-build-id:
	@echo $$((gcloud builds list --project $(PROJECT) --sort-by=~createTime --format='value(id)' --limit=1))

deploy-backend:
	@BUILD_ID=$$(gcloud builds list --project $(PROJECT) --sort-by=~createTime --format='value(id)' --limit=1); \
	kubectl -n $(NAMESPACE) set image deployment/backend backend=$(BACKEND_IMAGE):$$BUILD_ID; \
	kubectl -n $(NAMESPACE) rollout status deployment/backend

deploy-worker:
	@BUILD_ID=$$(gcloud builds list --project $(PROJECT) --sort-by=~createTime --format='value(id)' --limit=1); \
	kubectl -n $(NAMESPACE) set image deployment/summarize-worker summarize-worker=$(WORKER_IMAGE):$$BUILD_ID; \
	kubectl -n $(NAMESPACE) rollout status deployment/summarize-worker

deploy-all: build deploy-backend deploy-worker


# NetGuard

**پایش و تحلیل سیگنال‌های عمومی اینترنت ایران**

NetGuard presents public IODA measurements for Iran through a Persian, RTL React dashboard and a FastAPI data API.

## Architecture

- **React + Vite:** component-based frontend, client-side navigation, responsive RTL interface and charts.
- **FastAPI:** JSON API, health endpoint and static production hosting.
- **IODA adapter:** normalizes BGP, active-probing and network-telescope observations.
- **Container build:** multi-stage Docker build compiles React assets and packages the API.
- **Kubernetes:** example Deployment and Service manifests are provided in `k8s/`.

The current backend remains a single deployable API service. It is intentionally structured as a modular service rather than introducing distributed microservices, a message broker and a database before there is a measured need. The Kubernetes manifests provide a path to multiple API replicas, but the current in-process cache and refresh coordination are per process; use a shared cache/queue before relying on cross-replica cache consistency or running a dedicated collector.

## Run locally

API:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Frontend development server (in another terminal):

```bash
cd frontend
npm install
npm run dev
```

Vite proxies `/api` and `/static` to FastAPI at `127.0.0.1:8000`.

## Docker

```bash
docker build -f frontend/Dockerfile -t netguard .
docker run --rm -p 8000:8000 netguard
```

## Kubernetes

Build and publish the image, update `image` in `k8s/deployment.yaml`, then:

```bash
kubectl apply -f k8s/deployment.yaml
kubectl get deployment,service
```

The sample uses two API replicas and health probes. Before scaling beyond a small deployment, move cache and refresh coordination to a shared Redis service and run collection as a dedicated worker.

## API

- `GET /api/health`
- `GET /api/dashboard?hours=24`
- Supported windows: 6–168 hours.

## Measurement limitations

IODA is an upstream measurement source, not a measurement from every Iranian ISP or end-user. Missing observations are not zero. A change in one signal alone does not prove censorship, sanctions-related blocking, or the cause of a disruption. This release does not claim confirmed attribution or outage prediction.

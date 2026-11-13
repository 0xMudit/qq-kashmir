import os
os.environ["API_KEY"]="test-secret-123456"
os.environ["DATABASE_URL"]="sqlite:///:memory:"
from fastapi.testclient import TestClient
import app
H={"x-api-key":os.environ["API_KEY"]}
def test_health():
    with TestClient(app.app) as c:
        assert c.get("/health").status_code==200
def test_ordering_and_validation():
    with TestClient(app.app) as c:
        body={'vehicle':'bike-1','seq':2,'lat':34.08,'lon':74.79}
        assert c.post('/positions',json=body).status_code==401
        assert c.post('/positions',json=body,headers=H).json()['accepted']
        assert not c.post('/positions',json={**body,'seq':1,'lat':0},headers=H).json()['accepted']
        assert c.get('/positions',headers=H).json()[0]['lat']==34.08
        assert c.post('/positions',json={**body,'lat':91},headers=H).status_code==422
        assert c.get('/').status_code==200

import pytest
@pytest.fixture(autouse=True)
def clean_database():
    with TestClient(app.app):
        with app.engine.begin() as db:
            for table in app.SCHEMA.split(';'):
                if 'CREATE TABLE' in table:
                    table_name=table.split('EXISTS ')[1].split(' ')[0]
                    db.execute(app.text('DELETE FROM '+table_name))
    yield

def test_public_demo():
    with TestClient(app.app) as c:
        assert c.get('/').status_code==200
        response=c.post('/demo/run')
        assert response.status_code==200
        assert 'FAILED' not in response.json()['checks']

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Optional, Any
from utils import DataLoader, DietSolver
import pandas as pd
import numpy as np
import time
import json
import os

CATEGORY_MAP = {
    "01": "穀類",
    "02": "いも及びでん粉類",
    "03": "砂糖及び甘味類",
    "04": "豆類",
    "05": "種実類",
    "06": "野菜類",
    "07": "果実類",
    "08": "きのこ類",
    "09": "藻類",
    "10": "魚介類",
    "11": "肉類",
    "12": "卵類",
    "13": "乳類",
    "14": "油脂類",
    "15": "菓子類",
    "16": "し好飲料類",
    "17": "調味料及び香辛料類",
    "18": "調理加工食品類"
}

app = FastAPI()

# --- CORS CONFIGURATION ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 1. Load Data Once on Startup ---
loader = DataLoader(root_path="./data") 
df, nutrients_df, nutr_cols = loader.load_all()

solver = DietSolver(df, nutr_cols)

# Unit map for convenience
unit_map = nutrients_df.set_index("name")["unit"].to_dict()

# --- 2. Persistence Layer ---
DATA_FILE = "userdata/user_data.json"

def load_user_data():
    if not os.path.exists(DATA_FILE):
        return {"profiles": {}, "menus": {}}
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except:
        return {"profiles": {}, "menus": {}}

def save_user_data(data):
    directory = os.path.dirname(DATA_FILE)
    os.makedirs(directory, exist_ok=True)
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

# --- 3. Define Data Models (Schema) ---
class RatioConstraint(BaseModel):
    num: str
    den: str
    op: str = ">="
    ratio: float = 1.0

class FoodConstraint(BaseModel):
    id: str
    min: float = 0.0
    max: Optional[float] = None

class SolverConfig(BaseModel):
    nutrient_overrides: Dict[str, Dict[str, Any]] = {}
    w_price: float = 1.0
    w_mass: float = 1.0
    w_cals: float = 0.1
    max_foods: int = 15
    soft_penalty: float = 10000.0
    supplements_mode: str = "vit_c_d"
    banned_ids: List[str] = []
    food_constraints: List[FoodConstraint] = []
    ratios: List[RatioConstraint] = []
    current_stack: List[Dict[str, Any]] = []
    current_stack: List[Dict[str, Any]] = []
    solver_mode: str = "accurate" # "accurate" or "fast"
    shelf_stable_only: bool = False
    ban_inedible: bool = True
    ban_rare: bool = True
    ban_uncooked: bool = False
    ban_frozen: bool = False

class EvaluateRequest(BaseModel):
    items: List[Dict[str, Any]] 
    nutrient_overrides: Dict[str, Dict[str, Any]] = {}

# Unified Profile Model
class SaveProfileRequest(BaseModel):
    name: str = "My Profile"
    config: SolverConfig
    menu: List[Dict[str, Any]] = []
    overwrite: bool = False

class SaveStateRequest(BaseModel):
    config: SolverConfig
    menu: List[Dict[str, Any]] = []

# Simple Request for updating last profile
class SetLastProfileRequest(BaseModel):
    name: str

class SaveMenuRequest(BaseModel):
    name: str
    items: List[Dict[str, Any]]

# --- Helper: Sanitize JSON ---
def clean_json(data):
    """Recursively converts numpy types to native Python types for JSON serialization."""
    if isinstance(data, list):
        return [clean_json(x) for x in data]
    if isinstance(data, dict):
        return {k: clean_json(v) for k, v in data.items()}
    
    if isinstance(data, (np.int_, np.intc, np.intp, np.int8,
                         np.int16, np.int32, np.int64, np.uint8,
                         np.uint16, np.uint32, np.uint64)):
        return int(data)
    
    if isinstance(data, (np.float64, np.float16, np.float32, float)):
        if np.isnan(data) or np.isinf(data):
            return None
        return float(data)
        
    if isinstance(data, (np.bool_)):
        return bool(data)
        
    return data

def apply_overrides(L, U, overrides):
    for nutrient, limits in overrides.items():
        if not limits: continue
        if "min" in limits and limits["min"] is not None:
            L[nutrient] = limits["min"]
        if "max" in limits and limits["max"] is not None:
            U[nutrient] = limits["max"]
    return L, U

def generate_breakdown(sub_df, active_nutrients):
    """Calculates the contribution of each food to each nutrient."""
    if sub_df.empty:
        return []
        
    breakdown_list = []
    
    for n in active_nutrients:
        if n in sub_df.columns:
            vals = sub_df[n].fillna(0).values * sub_df['amount_100g'].values
            contrib_dict = dict(zip(sub_df['id'], vals))
            breakdown_list.append({
                "nutrient": n,
                "contributions": contrib_dict
            })
            
    return breakdown_list

# --- 4. Endpoints ---

@app.get("/foods")
def get_foods():
    # Include new flags for UI filtering/display
    cols_to_return = ["id", "name", "label", "category", "banned_reason", "is_inedible", "is_rare", "is_uncooked", "is_proxy", "edibility_note"]
    # Ensure they exist
    for c in cols_to_return:
        if c not in df.columns:
            df[c] = None
            
    clean_df = df[cols_to_return].replace([np.inf, -np.inf], None).fillna("")
    return clean_json(clean_df.to_dict(orient="records"))

@app.get("/nutrients")
def get_nutrients():
    # Build full metadata list
    result = []
    # Create a quick lookup for efficiency
    meta_map = nutrients_df.set_index("name")[["dv", "maximum", "unit"]].to_dict(orient="index")
    
    for n in sorted(nutr_cols):
        meta = meta_map.get(n, {})
        mn = meta.get("dv")
        mx = meta.get("maximum")
        
        # Handle NaN/None
        if pd.isna(mn): mn = 0
        if pd.isna(mx) or mx == float('inf'): mx = None
        
        result.append({
            "name": n,
            "min": mn,
            "max": mx,
            "unit": meta.get("unit", "")
        })
    return clean_json(result)

@app.get("/rank/{nutrient}")
def rank_foods(nutrient: str, exclude_supplements: bool = False, limit: int = 50, rank_by_value: bool = False):
    if nutrient not in df.columns:
        raise HTTPException(status_code=404, detail="Nutrient not found")
    
    # Filter
    # Threshold: 1e-5 (1mg) to ensure high-density foods (e.g. seaweed, spices) are included
    mask = (df[nutrient] > 1e-5)
    if exclude_supplements:
        mask &= (df["supplement"] == False)
    
    # Value Ranking Logic
    working_df = df[mask].copy()

    if rank_by_value:
        # Exclude items with no price or zero price to avoid division by zero or infinite value
        working_df = working_df[working_df["price"] > 0].copy()
        
        # Calculate Amount per Yen (Amount / Price)
        # Note: Both are per 100g, so the ratio is correct (Amount per 100g / Price per 100g = Amount / Price)
        working_df["_rank_score"] = working_df[nutrient] / working_df["price"]
        ranked = working_df.sort_values("_rank_score", ascending=False).head(limit)
    else:
        ranked = working_df.sort_values(nutrient, ascending=False).head(limit)
    
    result = []
    for _, row in ranked.iterrows():
        # Calculate amount per yen for display if possible
        apy = 0
        if row["price"] > 0:
            apy = row[nutrient] / row["price"]

        result.append({
            "id": row["id"],
            "name": row["name"],
            "label": row["label"],
            "category": row["category"],
            "amount": row[nutrient],
            "amount_per_yen": apy,
            "price": row["price"],
            "unit": unit_map.get(nutrient, ""),
            "banned_reason": row.get("banned_reason"),
            "is_inedible": row.get("is_inedible"),
            "is_rare": row.get("is_rare"),
            "is_uncooked": row.get("is_uncooked"),
            "is_proxy": row.get("is_proxy")
        })
        
    return clean_json(result)

@app.get("/food/{food_id}")
def get_food_details(food_id: str):
    if food_id not in df["id"].values:
        raise HTTPException(status_code=404, detail="Food not found")
    
    row = df[df["id"] == food_id].iloc[0]
    
    details = {}
    details = {}
    meta = ["id", "name", "label", "category", "CALORIES", "price", "food_id", "banned_reason",
            "is_inedible", "is_rare", "is_uncooked", "is_proxy", "edibility_note"]
    
    for c in meta:
        if c in row:
            if c == "category":
                # Apply mapping
                cat_id = str(row[c])
                label = CATEGORY_MAP.get(cat_id, "Unknown")
                details[c] = f"{label} ({cat_id})"
                details["category_id"] = cat_id
            else:
                details[c] = row[c]
            
    nutrients = []
    for n in nutr_cols:
        if n in row: # Include everything, even 0
             nutrients.append({
                 "name": n,
                 "amount": row[n],
                 "unit": unit_map.get(n, "")
             })
    
    details["nutrients"] = nutrients

    # Add recorded prices
    prices = []
    if hasattr(loader, "prices_df"):
        # Filter by food_id
        price_rows = loader.prices_df[loader.prices_df["food id"] == food_id].copy()
        if not price_rows.empty:
            for _, prow in price_rows.iterrows():
                price_entry = {
                    "name": prow.get("food", ""), # Product name
                    "price": prow.get("price", 0), # Total price
                    "package": prow.get("package", 0),
                    "unit": prow.get("unit", ""),
                    "price_per_g": prow.get("price_per_100g", 0) / 100.0, # Convert 100g to 1g
                    "source": prow.get("source", ""),
                    "note": prow.get("note", "")
                }
                # Add proxy info if this is a proxy-derived price
                if "proxy_source_id" in prow and pd.notna(prow.get("proxy_source_id")):
                    price_entry["proxy_source_id"] = prow.get("proxy_source_id", "")
                    price_entry["proxy_source_name"] = prow.get("proxy_source_name", "")
                    price_entry["proxy_via"] = prow.get("proxy_via", "")
                    price_entry["proxy_weight_ratio"] = prow.get("proxy_weight_ratio", 1.0)
                prices.append(price_entry)
    
    details["prices"] = clean_json(prices)
    return clean_json(details)

@app.post("/solve")
def solve_diet(req: SolverConfig):
    start_time = time.time()
    
    L = nutrients_df.set_index("name")["dv"].fillna(0).to_dict()
    U = nutrients_df.set_index("name")["maximum"].fillna(np.inf).to_dict()
    
    L_default = L.copy()
    U_default = U.copy()

    L, U = apply_overrides(L, U, req.nutrient_overrides)

    food_cons_dict = {fc.id: {'min': fc.min, 'max': fc.max} for fc in req.food_constraints}
    for bid in req.banned_ids:
        if bid in food_cons_dict: food_cons_dict[bid]['max'] = 0.0
        else: food_cons_dict[bid] = {'min': 0.0, 'max': 0.0}
    
    stack_tuples = [(item['id'], item['amount_100g']) for item in req.current_stack]
    
    res_foods, res_report = solver.solve(
        L, U, 
        req.w_price, req.w_mass, req.w_cals,
        req.max_foods, req.supplements_mode, req.soft_penalty,
        food_constraints=food_cons_dict,
        ratios=[r.dict() for r in req.ratios],
        current_stack=stack_tuples,
        solver_mode=req.solver_mode,
        shelf_stable_only=req.shelf_stable_only,
        ban_inedible=req.ban_inedible,
        ban_rare=req.ban_rare,
        ban_uncooked=req.ban_uncooked,
        ban_frozen=req.ban_frozen
    )

    if res_foods is None:
        raise HTTPException(status_code=400, detail="Solver failed to find a solution")

    res_report["target_default"] = res_report["nutrient"].map(L_default).fillna(0)
    res_report["max_default"] = res_report["nutrient"].map(U_default).replace(np.inf, None)
    res_report["unit"] = res_report["nutrient"].map(unit_map).fillna("")

    active_nutrients = res_report["nutrient"].tolist()
    breakdown = generate_breakdown(res_foods, active_nutrients)

    elapsed_time = time.time() - start_time

    return clean_json({
        "shopping_list": res_foods[["id", "name", "label", "amount_g", "price", "total_price"]].to_dict(orient="records"),
        "nutrients": res_report.to_dict(orient="records"),
        "breakdown": breakdown,
        "totals": {
            "cost": res_foods["total_price"].sum(),
            "mass": res_foods["amount_g"].sum(),
            "calories": res_report[res_report["nutrient"]=="CALORIES"]["achieved"].iloc[0] if "CALORIES" in res_report["nutrient"].values else 0
        },
        "time_taken": elapsed_time
    })

@app.post("/evaluate")
def evaluate_diet(req: EvaluateRequest):
    L = nutrients_df.set_index("name")["dv"].fillna(0).to_dict()
    U = nutrients_df.set_index("name")["maximum"].fillna(np.inf).to_dict()
    
    L_default = L.copy()
    U_default = U.copy()

    L, U = apply_overrides(L, U, req.nutrient_overrides)

    active_nutrients = [n for n in nutr_cols if n in L or n in U]

    if not req.items:
        sub_df = pd.DataFrame(columns=["id", "name", "label", "amount_g", "price", "total_price", "amount_100g"])
        achieved_vec = np.zeros(len(active_nutrients))
        total_cost = 0
        total_mass = 0
    else:
        item_map = {x['id']: x['amount_g'] for x in req.items}
        ids = list(item_map.keys())
        sub_df = df[df['id'].isin(ids)].copy()
        
        sub_df['amount_g'] = sub_df['id'].map(item_map)
        sub_df['amount_100g'] = sub_df['amount_g'] / 100.0
        sub_df['total_price'] = sub_df['price'] * sub_df['amount_100g']
        
        A_nut = sub_df[active_nutrients].fillna(0).to_numpy().T 
        x_amounts = sub_df['amount_100g'].to_numpy()
        achieved_vec = A_nut @ x_amounts
        
        total_cost = sub_df["total_price"].sum()
        total_mass = sub_df["amount_g"].sum()

    L_vec = np.array([L.get(n, 0) for n in active_nutrients])
    U_vec = np.array([U.get(n, np.inf) for n in active_nutrients])
    
    violations = np.maximum(0, achieved_vec - U_vec)
    
    report_df = pd.DataFrame({
        "nutrient": active_nutrients,
        "target": L_vec,
        "max": U_vec, 
        "achieved": achieved_vec,
        "violation_excess": violations,
        "target_default": [L_default.get(n, 0) for n in active_nutrients],
        "max_default": [U_default.get(n, np.inf) for n in active_nutrients]
    })
    
    report_df["unit"] = report_df["nutrient"].map(unit_map).fillna("")
    
    cals = 0
    if "CALORIES" in report_df["nutrient"].values:
        cals = report_df[report_df["nutrient"]=="CALORIES"]["achieved"].iloc[0]

    breakdown = generate_breakdown(sub_df, active_nutrients)

    return clean_json({
        "shopping_list": sub_df[["id", "name", "label", "amount_g", "price", "total_price"]].to_dict(orient="records"),
        "nutrients": report_df.to_dict(orient="records"),
        "breakdown": breakdown,
        "totals": {
            "cost": total_cost,
            "mass": total_mass,
            "calories": cals
        }
    })

# --- User Data Endpoints ---

@app.get("/profiles")
def get_profiles():
    data = load_user_data()
    profiles = data.get("profiles", {})
    # Return list of summaries
    profile_list = []
    for name, pdata in profiles.items():
        profile_list.append({
            "name": name,
            "updated_at": pdata.get("updated_at"),
            "summary": pdata.get("summary", {})
        })
    return clean_json({
        "profiles": profile_list,
        "last_profile": data.get("last_profile", None)
    })

@app.get("/profile/{name}")
def get_profile(name: str):
    data = load_user_data()
    profiles = data.get("profiles", {})
    if name not in profiles:
        raise HTTPException(status_code=404, detail="Profile not found")
    return clean_json(profiles[name])

@app.post("/profiles")
def save_profile(req: SaveProfileRequest):
    data = load_user_data()
    if "profiles" not in data: data["profiles"] = {}
    
    if req.name in data["profiles"] and not req.overwrite:
        raise HTTPException(status_code=409, detail=f"Profile '{req.name}' already exists")
    
    # Calculate summary
    total_cost = sum(item.get("price", 0) * (item.get("amount_g", 0)/100.0) for item in req.menu) if req.menu else 0
    total_mass = sum(item.get("amount_g", 0) for item in req.menu) if req.menu else 0
    # Calories is tricky without recalculating, but we can try to estimate or just skip if expensive
    # Let's simple check if the client sent it? No, client sends raw list.
    # We can just store 0 for now or do a quick lookup if needed.
    # For now, let's keep it simple.
    
    summary = {
        "cost": total_cost,
        "mass": total_mass,
        "item_count": len(req.menu)
    }

    # Save unified profile with metadata
    data["profiles"][req.name] = {
        "config": req.config.dict(),
        "menu": req.menu,
        "summary": summary,
        "updated_at": time.strftime("%Y-%m-%d %H:%M:%S")
    }
    
    # Update last active profile
    data["last_profile"] = req.name
    
    save_user_data(data)
    return {"message": "Saved", "name": req.name}

# --- State Autosave ---
@app.get("/state/latest")
def get_latest_state():
    data = load_user_data()
    return clean_json(data.get("latest_state", {}))

@app.post("/state/latest")
def save_latest_state(req: SaveStateRequest):
    data = load_user_data()
    data["latest_state"] = {
        "config": req.config.dict(),
        "menu": req.menu,
        "updated_at": time.strftime("%Y-%m-%d %H:%M:%S") 
    }
    save_user_data(data)
    return {"message": "State autosaved"}

@app.delete("/profile/{name}")
def delete_profile(name: str):
    data = load_user_data()
    if "profiles" in data and name in data["profiles"]:
        del data["profiles"][name]
        # If deleted profile was the last active one, clear it
        if data.get("last_profile") == name:
            data["last_profile"] = None
        save_user_data(data)
    return {"message": "Deleted"}

@app.post("/profile/last")
def set_last_profile(req: SetLastProfileRequest):
    data = load_user_data()
    data["last_profile"] = req.name
    save_user_data(data)
    return {"status": "ok", "last_profile": req.name}

@app.get("/userdata")
def download_user_data():
    return load_user_data()

# --- Deprecated Menu Endpoints (Kept briefly or removed if desired, but user says no backward compatibility worry) ---
# We can remove them to clean up since we are merging menus into profiles.

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8888)
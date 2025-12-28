# -*- coding: utf-8 -*-
import pandas as pd
import numpy as np
import re
import sys
from scipy.optimize import milp, LinearConstraint, Bounds

# ==========================================
# 1. Data Loader Class
# ==========================================
class DataLoader:
    def __init__(self, root_path="./"):
        self.root_path = root_path
        if not self.root_path.endswith("/"):
            self.root_path += "/"
    
    def _create_label(self, name):
        if not isinstance(name, str):
            return ""
        # Remove full-width brackets: ［...］, （...）, ＜...＞
        s = re.sub(r'［[^］]*］|（[^）]*）|＜[^＞]*＞', '', name)
        # Replace full-width space with regular space
        s = s.replace('\u3000', ' ')
        # Trim whitespaces
        return s.strip()

    def load_all(self):
        # --- Load Nutrients ---
        try:
            nutrients_df = pd.read_csv(self.root_path + "nutrients.csv")
            nutrients_df = nutrients_df[~nutrients_df["name"].isin(["LINOLEIC_ACID"])]
        except FileNotFoundError:
            print(f"Error: File not found: {self.root_path}nutrients.csv", file=sys.stderr)
            return pd.DataFrame(), pd.DataFrame(), []
        
        # --- Load Foods ---
        try:
            # Force food_id to string to preserve trailing zeros
            df = pd.read_csv(self.root_path + "foods.csv", dtype={"id": str, "category": str, "food_id": str})
        except FileNotFoundError:
            print(f"Error: File not found: {self.root_path}foods.csv", file=sys.stderr)
            return pd.DataFrame(), pd.DataFrame(), []
        
        # Merge extra files
        for ext in ["_amino", "_carb", "_fatty_acid", "_fiber", "_organic_acid"]:
            fname = f"foods{ext}.csv"
            try:
                sub_df = pd.read_csv(self.root_path + fname, dtype={"id": str})
                cols = [c for c in sub_df.columns if c not in df.columns or c == "id"]
                df = df.merge(sub_df[cols], on="id", how="left")
            except FileNotFoundError:
                pass

        # Cleanup columns
        df.columns = df.columns.str.strip()
        df = df.rename(columns=dict(zip(nutrients_df["fooddb_id"], nutrients_df["name"])))
        df = df.rename(columns={"NA": "SODIUM"})

        # Optional merges
        df = self._safe_merge(df, "caffeine.csv", "caffeine", "CAFFEINE")
        df = self._safe_merge(df, "isoflavones.csv", "amount", "ISOFLAVONE")

        # Clean numerics
        nutr_cols = [c for c in df.columns if c in nutrients_df["name"].tolist()]
        df[nutr_cols] = (
            df[nutr_cols]
            .replace({r'^\(([-+]?\d*\.?\d+)\)$': r'\1', r'^\(?\s*(?i:tr(?:ace)?)\s*\)?$': '0'}, regex=True)
            .replace(['—','–','-','N/A','*',' ','†'], 0)
            .replace({r'\s*(mg|µg|mcg)$': ''}, regex=True)
            .apply(pd.to_numeric, errors='coerce')
            .fillna(0)
        )

        # Load Extra Foods
        try:
            extra_df = pd.read_csv(self.root_path + "foods_extra.csv", dtype={"id": str})
            extra_df = extra_df[extra_df["active"] == True].dropna(subset=["id"])
            common_cols = [c for c in nutr_cols if c in extra_df.columns]
            extra_df[common_cols] = extra_df[common_cols].astype(float).mul(100.0 / extra_df["amount_g"], axis=0)
            extra_df["supplement"] = True
            df["supplement"] = False
            df = pd.concat([df, extra_df], ignore_index=True)
        except FileNotFoundError:
            pass
        
        df[nutr_cols] = df[nutr_cols].fillna(0)

        # Load Prices
        try:
            prices_df = pd.read_csv(self.root_path + "prices.csv", dtype={"food id": str})
            prices_df = prices_df[prices_df["active"] == True]
            prices_df["price"] = prices_df["price"].replace(r"[\(¥,]", "", regex=True).astype(float)
            prices_df["cooked/raw ratio"] = pd.to_numeric(prices_df["cooked/raw ratio"], errors='coerce').fillna(1)
            prices_df["package"] = pd.to_numeric(prices_df["package"], errors='coerce')
            prices_df["price_per_100g"] = prices_df["price"] / (prices_df["package"] * prices_df["cooked/raw ratio"]) * 100
            
            # Load Price Proxies and generate proxy price entries
            try:
                proxies_df = pd.read_csv(self.root_path + "price_proxies.csv", dtype={"proxy id": str, "target id": str})
                proxy_entries = []
                
                for _, proxy_row in proxies_df.iterrows():
                    proxy_id = proxy_row["proxy id"]
                    target_id = proxy_row["target id"]
                    weight_ratio = pd.to_numeric(proxy_row.get("weight ratio", 1), errors='coerce')
                    if pd.isna(weight_ratio) or weight_ratio == 0:
                        weight_ratio = 1.0
                    proxy_via = proxy_row.get("proxy via", "")
                    proxy_name = proxy_row.get("proxy name", "")
                    
                    # Find all price entries for the proxy food
                    proxy_prices = prices_df[prices_df["food id"] == proxy_id]
                    
                    for _, prow in proxy_prices.iterrows():
                        # Create a new price entry for the target food
                        new_entry = prow.copy()
                        new_entry["food id"] = target_id
                        # Adjust package size by weight_ratio (effectively divides price_per_100g by ratio)
                        new_entry["package"] = prow["package"] * weight_ratio
                        new_entry["price_per_100g"] = prow["price"] / (new_entry["package"] * prow["cooked/raw ratio"]) * 100
                        # Mark as proxy-derived
                        new_entry["proxy_source_id"] = proxy_id
                        new_entry["proxy_source_name"] = proxy_name
                        new_entry["proxy_via"] = proxy_via
                        new_entry["proxy_weight_ratio"] = weight_ratio
                        proxy_entries.append(new_entry)
                
                if proxy_entries:
                    proxy_prices_df = pd.DataFrame(proxy_entries)
                    prices_df = pd.concat([prices_df, proxy_prices_df], ignore_index=True)
            except FileNotFoundError:
                pass  # No price proxies file, continue without
            
            # Store full prices for detailed view
            self.prices_df = prices_df.copy()
            
            # For solver, keep cheapest
            prices_cheapest = prices_df.sort_values("price_per_100g").drop_duplicates(subset=["food id"], keep="first")
            df = df.merge(prices_cheapest[["food id", "price_per_100g", "shelf stable", "frozen"]], left_on="id", right_on="food id", how="left")
            df = df.rename(columns={"price_per_100g": "price", "shelf stable": "shelf_stable", "frozen": "is_frozen"})
        except FileNotFoundError:
            self.prices_df = pd.DataFrame(columns=["food id", "price", "package", "unit", "source", "note", "price_per_100g"])
            df["price"] = 0
            df["shelf_stable"] = False
            df["is_frozen"] = False

        # Generate Label
        df["label"] = df["name"].apply(self._create_label)

        # Load Edibility and Rare info to determine Banned status
        try:
            # 1. Load Rare
            rare_df = pd.read_csv(self.root_path + "rare.csv", dtype={"id": str})
            rare_ids = set(rare_df["id"].dropna())
            
            # 2. Load Edibility
            edibility_df = pd.read_csv(self.root_path + "edibility.csv", dtype={"id": str})
            # Columns: food_id, id, proxy of edible form, inedible, uncooked, edible, name, note, fooddb note
            
            # Merge edibility info into df
            # We only need 'inedible' and 'proxy of edible form' for banning logic
            # 'uncooked' is descriptive but doesn't ban by itself. 'edible' is inverse of inedible usually?
            cols_to_use = ["id", "inedible", "proxy of edible form"]
            edibility_subset = edibility_df[cols_to_use].copy()
            
            # Merge
            df = df.merge(edibility_subset, on="id", how="left")
            
            # Apply Banning Logic
            # Banned if: (Inedible=True OR Rare=True) AND (Proxy=False/NaN)
            # Note: booleans in csv might be strings "TRUE"/"FALSE" or actual booleans if pandas parsed them.
            # safe conversion
            def is_true(x):
                return str(x).upper() == "TRUE"
                
            df["is_inedible"] = df["inedible"].apply(is_true)
            df["is_proxy"] = df["proxy of edible form"].apply(is_true)
            df["is_rare"] = df["id"].isin(rare_ids)
            
            # Determine banned reason
            def get_reason(row):
                if row["is_proxy"]:
                    return None # Allowed
                
                reasons = []
                if row["is_inedible"]:
                    reasons.append("inedible")
                if row["is_rare"]:
                    reasons.append("rare")
                    
                if reasons:
                    return ", ".join(reasons)
                return None

            df["banned_reason"] = df.apply(get_reason, axis=1)
            
            # Cleanup temp columns, but KEEP flags for UI display
            # We need: is_inedible, is_rare, is_uncooked, is_proxy, edibility_note
            # Also load 'note' from edibility
            df["edibility_note"] = edibility_df["note"]
            
            # Additional flag: is_uncooked
            # "uncooked" column in csv
            def safe_bool(x): return str(x).upper() == "TRUE"
            df["is_uncooked"] = edibility_df["uncooked"].apply(safe_bool)
            
            # We keep these columns now: 
            # is_inedible, is_proxy, is_rare, is_uncooked, edibility_note, banned_reason
            df = df.drop(columns=["inedible", "proxy of edible form"], errors="ignore")
            
        except FileNotFoundError:
            # Fallback or strict error? 
            # If files are missing, we assume nothing is banned? Or print error?
            print("Warning: rare.csv or edibility.csv not found, banning logic skipped.", file=sys.stderr)
            pass

        if "banned_reason" not in df.columns:
            df["banned_reason"] = None

        return df, nutrients_df, nutr_cols

    def _safe_merge(self, df, filename, col_from, col_to):
        try:
            sub = pd.read_csv(self.root_path + filename, dtype={"id": str})
            sub = sub.rename(columns={col_from: col_to})
            df = df.merge(sub[["id", col_to]], on="id", how="left")
            df[col_to] = df[col_to].fillna(0)
        except FileNotFoundError:
            pass
        return df

# ==========================================
# 2. Solver Class
# ==========================================
class DietSolver:
    def __init__(self, df, nutrient_cols):
        self.df = df.copy()
        self.nutrient_cols = nutrient_cols
        
    def solve(self, L, U,
              W_PRICE, W_MASS, W_CALS, 
              MAX_FOODS, supplements_mode, SOFT_UPPER_PENALTY, 
              food_constraints={}, # {id: {'min': 0, 'max': 100}}
              ratios=[], current_stack=[],
              solver_mode="accurate",
              shelf_stable_only=False,
              ban_inedible=True,
              ban_rare=True,
              ban_uncooked=False,
              ban_frozen=False): # "accurate" (MILP) or "fast" (LP)
        
        # Identify IDs that MUST be included (from current stack)
        forced_ids = set([fid for fid, _ in current_stack])

        # 1. Filter Foods
        # If a food has max=0 in constraints, it's banned
        banned_ids = set([fid for fid, c in food_constraints.items() if (c.get('max') is not None and c.get('max') <= 1e-6)])
        
        # Base Banned Mask
        mask_not_banned = ~self.df["id"].isin(list(banned_ids))
        if "banned_reason" in self.df.columns:
            mask_not_banned &= self.df["banned_reason"].isna()
        
        # Standard Filter Mask (Supplements, Price, etc.)
        mask_filters = pd.Series(True, index=self.df.index)
        
        if shelf_stable_only:
             mask_filters &= (self.df["shelf_stable"] == True)
        
        if ban_frozen:
             mask_filters &= (self.df["is_frozen"] == False)

        if supplements_mode == "none":
            mask_filters &= (self.df["supplement"] == False)
        elif supplements_mode == "vit_c_d":
            mask_filters &= (self.df["supplement"] == False) | (self.df["id"].isin(["EXTRA_1", "EXTRA_5"]))
        elif supplements_mode == "all":
            pass
        
        # Only filter out missing prices if we are actually optimizing for price.
        if W_PRICE > 1e-6:
            mask_filters &= self.df["price"].notna()
            
        # Combine
        final_mask = mask_not_banned & (mask_filters | self.df["id"].isin(list(forced_ids)))
        working_df = self.df[final_mask].reset_index(drop=True)
        
        # 2. Setup Dimensions
        foods = working_df["id"].tolist()
        id_to_idx = {fid: i for i, fid in enumerate(foods)}
        n_foods = len(foods)
        
        active_nutrients = [n for n in self.nutrient_cols if n in L or n in U]
        for r in ratios:
            if r['num'] not in active_nutrients: active_nutrients.append(r['num'])
            if r['den'] not in active_nutrients: active_nutrients.append(r['den'])
        active_nutrients = sorted(list(set(active_nutrients)))
        
        n_nutrients = len(active_nutrients)
        nut_to_idx = {n: i for i, n in enumerate(active_nutrients)}
        
        A_nut = working_df[active_nutrients].to_numpy().T
        prices = working_df["price"].fillna(0).to_numpy()
        cals = working_df["CALORIES"].fillna(0).to_numpy() if "CALORIES" in working_df.columns else np.zeros(n_foods)
        
        L_vec = np.array([L.get(n, 0) for n in active_nutrients])
        U_vec = np.array([U.get(n, np.inf) for n in active_nutrients])
        
        # --- Mode Switching ---
        if solver_mode == "fast":
            # Linear Programming (LP)
            total_vars = n_foods + n_nutrients
            idx_x, idx_s = 0, n_foods
            
            c = np.zeros(total_vars)
            c[idx_x : idx_x + n_foods] = (W_MASS * 1.0) + (W_PRICE * prices) + (W_CALS * cals) + 1e-6
            c[idx_s : idx_s + n_nutrients] = SOFT_UPPER_PENALTY
            
            constraints = []
            
            # Lower Bounds
            A_lower = np.hstack([A_nut, np.zeros((n_nutrients, n_nutrients))])
            constraints.append(LinearConstraint(A_lower, L_vec, np.inf))
            
            # Upper Bounds
            A_upper = np.hstack([A_nut, -np.eye(n_nutrients)])
            constraints.append(LinearConstraint(A_upper, -np.inf, U_vec))
            
            # Ratio Constraints
            for r in ratios:
                if r['num'] in nut_to_idx and r['den'] in nut_to_idx:
                    idx_n = nut_to_idx[r['num']]
                    idx_d = nut_to_idx[r['den']]
                    op = r.get('op', '>=')
                    val = float(r.get('ratio', 1.0))
                    
                    row_comb = A_nut[idx_n] - (val * A_nut[idx_d])
                    full_row = np.hstack([row_comb, np.zeros(n_nutrients)])
                    
                    if op == '>=': constraints.append(LinearConstraint([full_row], 0, np.inf))
                    elif op == '<=': constraints.append(LinearConstraint([full_row], -np.inf, 0))
                    elif op == '==': constraints.append(LinearConstraint([full_row], 0, 0))
            
            lb = np.zeros(total_vars)
            ub = np.full(total_vars, np.inf)
            
            integrality = np.zeros(total_vars) 
            
        else:
            # Accurate Mode (MILP)
            total_vars = 2 * n_foods + n_nutrients
            idx_x, idx_y, idx_s = 0, n_foods, 2 * n_foods
            
            c = np.zeros(total_vars)
            c[idx_x : idx_x + n_foods] = (W_MASS * 1.0) + (W_PRICE * prices) + (W_CALS * cals) + 1e-6
            c[idx_y : idx_y + n_foods] = 5.0 
            c[idx_s : idx_s + n_nutrients] = SOFT_UPPER_PENALTY
            
            constraints = []
            
            # Lower Bounds
            A_lower = np.hstack([A_nut, np.zeros((n_nutrients, n_foods)), np.zeros((n_nutrients, n_nutrients))])
            constraints.append(LinearConstraint(A_lower, L_vec, np.inf))
            
            # Upper Bounds
            A_upper = np.hstack([A_nut, np.zeros((n_nutrients, n_foods)), -np.eye(n_nutrients)])
            constraints.append(LinearConstraint(A_upper, -np.inf, U_vec))
            
            # Ratio Constraints
            for r in ratios:
                if r['num'] in nut_to_idx and r['den'] in nut_to_idx:
                    idx_n = nut_to_idx[r['num']]
                    idx_d = nut_to_idx[r['den']]
                    op = r.get('op', '>=')
                    val = float(r.get('ratio', 1.0))
                    
                    row_comb = A_nut[idx_n] - (val * A_nut[idx_d])
                    full_row = np.hstack([row_comb, np.zeros(n_foods + n_nutrients)])
                    
                    if op == '>=': constraints.append(LinearConstraint([full_row], 0, np.inf))
                    elif op == '<=': constraints.append(LinearConstraint([full_row], -np.inf, 0))
                    elif op == '==': constraints.append(LinearConstraint([full_row], 0, 0))

            # Linking x <= M * y
            M = 50.0 
            A_link = np.hstack([np.eye(n_foods), -M * np.eye(n_foods), np.zeros((n_foods, n_nutrients))])
            constraints.append(LinearConstraint(A_link, -np.inf, 0))
            
            # Max Foods
            A_count = np.zeros((1, total_vars))
            A_count[0, idx_y : idx_y + n_foods] = 1
            constraints.append(LinearConstraint(A_count, -np.inf, MAX_FOODS))

            lb = np.zeros(total_vars)
            ub = np.full(total_vars, np.inf)
            
            integrality = np.zeros(total_vars)
            integrality[idx_y : idx_y + n_foods] = 1 

        # --- Common Bounds & Execution ---
        for fid, constr in food_constraints.items():
            if fid in id_to_idx:
                idx = id_to_idx[fid]
                mn = constr.get('min', 0.0)
                mx = constr.get('max')
                if mx is None: mx = 1000.0
                
                lb[idx_x + idx] = mn
                ub[idx_x + idx] = mx
                
                if solver_mode == "accurate":
                    if mn > 0: lb[idx_y + idx] = 1 
                    if mx <= 1e-6: ub[idx_y + idx] = 0

        for fid, val in current_stack:
            if fid in id_to_idx:
                idx = id_to_idx[fid]
                lb[idx_x + idx] = max(lb[idx_x + idx], val)
                if solver_mode == "accurate":
                    lb[idx_y + idx] = 1

        if solver_mode == "accurate":
            lb[idx_y : idx_y + n_foods] = np.maximum(lb[idx_y : idx_y + n_foods], 0)
            ub[idx_y : idx_y + n_foods] = np.minimum(ub[idx_y : idx_y + n_foods], 1)
        
        res = milp(c=c, constraints=constraints, bounds=Bounds(lb, ub), integrality=integrality)
        
        if not res.success:
            return None, None
            
        x_sol = res.x[idx_x : idx_x + n_foods]
        s_sol = res.x[idx_s : idx_s + n_nutrients]
        
        working_df["amount_100g"] = x_sol
        working_df["amount_g"] = x_sol * 100
        working_df["total_price"] = working_df["amount_100g"] * working_df["price"]
        
        threshold = 1e-5 # 1mg threshold to capture high-density foods like seaweed/spices
        result_df = working_df[working_df["amount_100g"] > threshold].copy().sort_values("amount_100g", ascending=False)
        
        achieved = A_nut @ x_sol
        report_df = pd.DataFrame({
            "nutrient": active_nutrients,
            "target": L_vec,
            "max": U_vec,
            "achieved": achieved,
            "violation": s_sol
        })
        report_df["pct"] = (report_df["achieved"] / report_df["target"] * 100).fillna(0)
        
        return result_df, report_df
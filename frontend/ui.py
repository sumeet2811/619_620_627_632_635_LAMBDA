import streamlit as st
import requests
import pandas as pd
from datetime import datetime, timedelta

st.set_page_config(page_title="Lambda Function Runner", layout="centered")

st.title("💡 AWS-Lambda lite!!")
st.write("Create, view, update, delete and execute serverless functions.")

menu = st.sidebar.selectbox(
    "Choose an action", 
    ["Create Function", "View Functions", "Update Function", "Delete Function", "Execute Code", "gVisor Execution", "History"]
)

if menu == "Create Function":
    st.header("📝 Create New Function")
    name = st.text_input("Function Name")
    language = st.selectbox("Language", ["python", "javascript"])  # added JavaScript option
    code = st.text_area("Enter your code")
    timeout = st.number_input("Timeout (seconds)", min_value=1, max_value=60, value=5)

    if st.button("Create Function"):
        payload = {
            "name": name,
            "language": language,
            "code": code,
            "timeout": timeout
        }
        try:
            # Use different endpoint based on language
            endpoint = "http://localhost:3000/api/js-functions" if language == "javascript" else "http://localhost:3000/api/functions"
            response = requests.post(endpoint, json=payload)
            if response.status_code == 201:
                st.success(f"Function created! ID: {response.json()['function_id']}")
            else:
                st.error(f"Error: {response.text}")
        except Exception as e:
            st.error(f"Could not connect to backend: {e}")

elif menu == "View Functions":
    st.header("📋 Stored Functions")
    try:
        response = requests.get("http://localhost:3000/api/functions")
        if response.status_code == 200:
            functions = response.json()
            if functions:
                for func in functions:
                    st.code(f"ID: {func['id']}\nName: {func['name']} ({func['language']})\nCode:\n{func['code']}")
            else:
                st.write("No functions found.")
        else:
            st.error("Failed to fetch functions.")
    except Exception as e:
        st.error(f"Could not connect to backend: {e}")

elif menu == "Update Function":
    st.header("✏️ Update Existing Function")
    id = st.text_input("Function ID to update")
    name = st.text_input("New Function Name")
    language = st.selectbox("New Language", ["python", "javascript"])  # added JavaScript option
    code = st.text_area("New Code")
    timeout = st.number_input("New Timeout (seconds)", min_value=1, max_value=60, value=5)

    if st.button("Update Function"):
        payload = {
            "name": name,
            "language": language,
            "code": code,
            "timeout": timeout
        }
        try:
            # Use different endpoint based on language
            endpoint = f"http://localhost:3000/api/js-functions/{id}" if language == "javascript" else f"http://localhost:3000/api/functions/{id}"
            response = requests.put(endpoint, json=payload)
            if response.status_code == 200:
                st.success("Function updated successfully!")
            else:
                st.error(f"Error: {response.text}")
        except Exception as e:
            st.error(f"Could not connect to backend: {e}")

elif menu == "Delete Function":
    st.header("🗑️ Delete Function")
    id = st.text_input("Function ID to delete")

    if st.button("Delete Function"):
        try:
            # First get the function to determine its language
            get_response = requests.get(f"http://localhost:3000/api/functions/{id}")
            if get_response.status_code == 200:
                function_data = get_response.json()
                language = function_data.get('language', 'python')
                
                # Use different endpoint based on language
                endpoint = f"http://localhost:3000/api/js-functions/{id}" if language == "javascript" else f"http://localhost:3000/api/functions/{id}"
                response = requests.delete(endpoint)
                if response.status_code == 200:
                    st.success("Function deleted successfully!")
                else:
                    st.error(f"Error: {response.text}")
            else:
                st.error(f"Error: {get_response.text}")
        except Exception as e:
            st.error(f"Could not connect to backend: {e}")

elif menu == "Execute Code":
    st.header("🚀 Execute Ad-hoc Code")
    language = st.selectbox("Language", ["python", "javascript"])
    code = st.text_area("Enter code to execute")
    timeout = st.number_input("Timeout (seconds)", min_value=1, max_value=60, value=5)

    if st.button("Run Code"):
        payload = {"code": code, "timeout": timeout, "language": language}
        try:
            # Use different endpoint based on language
            endpoint = "http://localhost:3000/api/execute"
            response = requests.post(endpoint, json=payload)
            if response.status_code == 200:
                st.success("Output:")
                st.code(response.json()['output'])
                
                # Display metrics for this execution
                st.subheader("📊 Execution Metrics")
                metrics_response = requests.get("http://localhost:3000/api/execute/metrics")
                if metrics_response.status_code == 200:
                    metrics_data = metrics_response.json()
                    if metrics_data['detailed_metrics'] and len(metrics_data['detailed_metrics']) > 0:
                        latest_metric = metrics_data['detailed_metrics'][0]
                        
                        col1, col2 = st.columns(2)
                        with col1:
                            st.metric("Status", latest_metric['status'])
                        with col2:
                            st.metric("Execution Time", f"{latest_metric['execution_time']:.2f}s")
                        
                        if latest_metric['error_message']:
                            st.error(f"Error: {latest_metric['error_message']}")
                    else:
                        st.info("No metrics available for this execution yet.")
                else:
                    st.warning("Could not fetch metrics for this execution.")
            else:
                st.error(f"Error: {response.text}")
        except Exception as e:
            st.error(f"Could not connect to backend: {e}")

elif menu == "gVisor Execution":
    st.header("🚀 Execute Code with gVisor")
    language = st.selectbox("Language", ["python", "javascript"])
    code = st.text_area("Enter code to execute")
    timeout = st.number_input("Timeout (seconds)", min_value=1, max_value=60, value=5)

    if st.button("Run with gVisor"):
        payload = {"code": code, "timeout": timeout, "language": language}
        try:
            # Use gVisor endpoint
            endpoint = "http://localhost:3000/api/gvisor/execute"
            response = requests.post(endpoint, json=payload)
            if response.status_code == 200:
                st.success("Output:")
                st.code(response.json()['output'])
                
                # Display metrics for this execution
                st.subheader("📊 Execution Metrics")
                metrics_response = requests.get("http://localhost:3000/api/gvisor/execute/metrics")
                if metrics_response.status_code == 200:
                    metrics_data = metrics_response.json()
                    if metrics_data['detailed_metrics'] and len(metrics_data['detailed_metrics']) > 0:
                        latest_metric = metrics_data['detailed_metrics'][0]
                        
                        col1, col2 = st.columns(2)
                        with col1:
                            st.metric("Status", latest_metric['status'])
                        with col2:
                            st.metric("Execution Time", f"{latest_metric['execution_time']:.2f}s")
                        
                        if latest_metric['error_message']:
                            st.error(f"Error: {latest_metric['error_message']}")
                    else:
                        st.info("No metrics available for this execution yet.")
                else:
                    st.warning("Could not fetch metrics for this execution.")
            else:
                st.error(f"Error: {response.text}")
        except Exception as e:
            st.error(f"Could not connect to backend: {e}")

elif menu == "History":
    st.header("📊 Execution History")
    
    try:
        # Get serverless functions metrics
        serverless_response = requests.get("http://localhost:3000/api/functions/metrics/aggregate")
        serverless_metrics = []
        if serverless_response.status_code == 200:
            serverless_metrics = serverless_response.json()
        
        # Get normal execution metrics
        normal_response = requests.get("http://localhost:3000/api/execute/metrics")
        normal_metrics = []
        if normal_response.status_code == 200:
            normal_data = normal_response.json()
            if normal_data['detailed_metrics']:
                # Create a summary for normal executions
                normal_summary = {
                    'function_id': 'normal_execution',
                    'function_name': 'Normal Code Execution',
                    'total_executions': normal_data['aggregated_metrics']['total_executions'],
                    'successful_executions': normal_data['aggregated_metrics']['successful_executions'],
                    'failed_executions': normal_data['aggregated_metrics']['failed_executions'],
                    'avg_execution_time': normal_data['aggregated_metrics']['avg_execution_time'],
                    'min_execution_time': normal_data['aggregated_metrics']['min_execution_time'],
                    'max_execution_time': normal_data['aggregated_metrics']['max_execution_time']
                }
                normal_metrics = [normal_summary]
        
        # Combine both metrics
        all_metrics = serverless_metrics + normal_metrics
        
        if all_metrics:
            # Convert to DataFrame for better display
            df = pd.DataFrame(all_metrics)
            # Format the dataframe for display
            df['avg_execution_time'] = df['avg_execution_time'].round(2)
            df['min_execution_time'] = df['min_execution_time'].round(2)
            df['max_execution_time'] = df['max_execution_time'].round(2)
            st.dataframe(df)
        else:
            st.info("No metrics available.")
    except Exception as e:
        st.error(f"Could not connect to backend: {e}")
